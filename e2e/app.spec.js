import { test, expect } from '@playwright/test';

const ID_URL = /\/[0-9A-Z]{10}$/;

async function createList(page, name = 'Weekly', device = 'Alex') {
  await page.goto('/');
  await page.getByLabel('Name of the list').fill(name);
  await page.getByLabel('Your device name').fill(device);
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.waitForURL(ID_URL);
  await expect(page.locator('.list-title')).toContainText(name);
  return page.url().split('/').pop();
}

async function join(browser, id, device, setup) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  await setup?.(ctx);
  const page = await ctx.newPage();
  await page.goto(`/${id}`);
  await page.getByLabel('Your device name').fill(device);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.list-title')).toBeVisible();
  return { ctx, page };
}

async function add(page, text) {
  const input = page.getByPlaceholder('Add item, e.g. 2 milk');
  await input.fill(text);
  await input.press('Enter');
}

const item = (page, name) => page.locator('.item', { has: page.getByRole('checkbox', { name, exact: true }) });

test.use({ locale: 'en-US' });

test('create, add, group and learn placement', async ({ page }) => {
  await createList(page);
  await add(page, '2 Milk');
  await add(page, '500g Minced meat');
  await expect(item(page, 'Milk').locator('.amount')).toHaveText('2×');
  await expect(item(page, 'Minced meat').locator('.amount')).toHaveText('500 g');

  // a new (empty) group becomes the target of the input
  await page.getByRole('button', { name: 'Add group' }).last().click();
  await page.getByLabel('Name').fill('Fridge');
  await page.getByRole('button', { name: 'Create' }).click();
  await add(page, 'Butter');
  const fridge = page.locator('.group', { hasText: 'Fridge' });
  await expect(fridge.getByRole('checkbox', { name: 'Butter' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to automatic group' }).click();
  // only one level of groups: no subgroups any more
  await page.getByRole('button', { name: 'Options for Fridge' }).first().click();
  await expect(page.getByRole('button', { name: 'Add subgroup' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // move Milk to Fridge
  await page.getByRole('button', { name: 'Edit Milk' }).click();
  await page.locator('.panel').getByLabel('Group').selectOption({ label: 'Fridge' });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(fridge.getByRole('checkbox', { name: 'Milk' })).toBeVisible();

  // remove and add again → learned placement
  await page.getByRole('button', { name: 'Edit Milk' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(item(page, 'Milk')).toHaveCount(0);
  await page.getByPlaceholder('Add item, e.g. 2 milk').fill('milk');
  await expect(page.locator('#add-target option').first()).toHaveText('→ Fridge');
  await page.getByPlaceholder('Add item, e.g. 2 milk').press('Enter');
  await expect(fridge.getByRole('checkbox', { name: 'milk' })).toBeVisible();

  // survives a reload (state comes from server)
  await page.reload();
  await expect(fridge.getByRole('checkbox', { name: 'milk' })).toBeVisible();
});

test('two devices sync, duplicates, autocomplete and history', async ({ page, browser }) => {
  const id = await createList(page);
  await add(page, 'Bread');
  const { page: b, ctx } = await join(browser, id, 'Jana');
  await expect(page.locator('.person', { hasText: 'Jana' }).locator('.dot.on')).toBeVisible();

  await b.getByRole('checkbox', { name: 'Bread' }).click();
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Bread')).not.toContainText('Jana'); // who did what lives in the details
  await page.getByRole('button', { name: 'Edit Bread' }).click();
  await expect(page.locator('.panel')).toContainText('checked by Jana');
  await page.keyboard.press('Escape');
  await expect(page.locator('.count')).toHaveText('1 / 1');

  // adding a checked item again re-activates it
  await add(b, 'bread');
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'false');

  // duplicate prompt for open items
  await add(b, '2 Bread');
  await b.getByRole('button', { name: 'Increase amount' }).click();
  await expect(item(page, 'Bread').locator('.amount')).toHaveText('3×');

  // autocomplete from history
  await page.getByRole('button', { name: 'Edit Bread' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await page.getByPlaceholder('Add item, e.g. 2 milk').fill('bre');
  await page.locator('.sugg .pick', { hasText: 'Bread' }).click();
  await expect(item(b, 'Bread')).toBeVisible();

  // history
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('.log')).toContainText('Jana');
  await expect(page.locator('.log')).toContainText('deleted Bread');
  await ctx.close();
});

test('offline edits sync later and simultaneous changes ask for a choice', async ({ page, browser }) => {
  const id = await createList(page);
  await add(page, 'Eggs');
  // simulate a dead network for B by cutting its websocket
  let offline = false;
  const sockets = [];
  const { page: b, ctx } = await join(browser, id, 'Jana', (c) =>
    c.routeWebSocket(/\/ws$/, (ws) => {
      if (offline) return ws.close();
      ws.connectToServer();
      sockets.push(ws);
    }),
  );
  await expect(b.getByRole('checkbox', { name: 'Eggs' })).toBeVisible();

  offline = true;
  for (const ws of sockets) await ws.close();
  await expect(b.locator('.hint', { hasText: 'Offline' })).toBeVisible({ timeout: 10_000 });
  // B changes the amount offline
  await b.getByRole('button', { name: 'Edit Eggs' }).click();
  await b.locator('.qty input').fill('12');
  await b.getByRole('button', { name: 'Done' }).click();
  await add(b, 'Butter');
  await expect(b.locator('.hint', { hasText: '2 changes wait' })).toBeVisible();

  // A changes the same field later, online
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: 'Edit Eggs' }).click();
  await page.locator('.qty input').fill('6');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('6×');

  offline = false;
  await b.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(item(page, 'Butter')).toBeVisible({ timeout: 20_000 });
  // newest change (A, 6) stays, but both see a soft conflict notice
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('6×');
  await expect(page.locator('.hint', { hasText: 'simultaneous change' })).toBeVisible();
  await page.getByRole('button', { name: 'Review' }).click();
  await page.locator('.opt', { hasText: '12×' }).click();
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('12×');
  await expect(item(b, 'Eggs').locator('.amount')).toHaveText('12×');
  await expect(b.locator('.hint', { hasText: 'simultaneous change' })).toHaveCount(0);
  await ctx.close();
});

test('paste several lines at once', async ({ page }) => {
  await createList(page);
  const input = page.getByPlaceholder('Add item, e.g. 2 milk');
  await input.focus();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '- Apples\n- 2 Pears\n\n• Coffee');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.getByRole('button', { name: 'Add 3 items' }).click();
  await expect(page.locator('.item')).toHaveCount(3);
  await expect(item(page, 'Pears').locator('.amount')).toHaveText('2×');
});

test('renew moves members, kick removes a device', async ({ page, browser }) => {
  const id = await createList(page);
  const { page: b, ctx } = await join(browser, id, 'Jana');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Renew ID' }).click();
  await page.getByRole('button', { name: 'Renew ID' }).click();
  await page.waitForURL((u) => !u.pathname.endsWith(id));
  const newId = page.url().split('/').pop();
  await b.waitForURL(new RegExp(`${newId}$`));

  // a stranger with the old link gets nothing
  const stranger = await browser.newContext({ locale: 'en-US' });
  const s = await stranger.newPage();
  await s.goto(`/${id}`);
  await s.getByLabel('Your device name').fill('Stranger');
  await s.getByRole('button', { name: 'Continue' }).click();
  await expect(s.getByRole('heading', { name: 'ID not found' })).toBeVisible();
  await stranger.close();

  // kick Jana
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Participants' }).click();
  await page.getByRole('button', { name: 'Remove Jana' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(b.getByRole('heading', { name: 'You were removed' })).toBeVisible();
  await b.getByRole('button', { name: 'Rejoin' }).click();
  await expect(b.locator('.list-title')).toBeVisible();
  await ctx.close();
});

test('delete for everyone, continue with a new ID', async ({ page, browser }) => {
  const id = await createList(page, 'Party');
  await add(page, 'Chips');
  const { page: b, ctx } = await join(browser, id, 'Jana');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Delete ID for everyone' }).click();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await page.getByLabel('Type “Party” to confirm').fill('party');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(b.getByRole('heading', { name: 'This list was deleted' })).toBeVisible();
  await b.getByRole('button', { name: 'Continue with new ID' }).click();
  await b.waitForURL((u) => ID_URL.test(u.pathname) && !u.pathname.endsWith(id));
  await expect(b.getByRole('checkbox', { name: 'Chips' })).toBeVisible();
  await ctx.close();
});

test('shopping mode is visible to others', async ({ page, browser }) => {
  const id = await createList(page);
  await add(page, 'Tea');
  const { page: b, ctx } = await join(browser, id, 'Jana');
  await page.getByRole('button', { name: "I'm shopping" }).click();
  await expect(b.locator('.hint', { hasText: 'Alex is shopping right now' })).toBeVisible();
  await add(b, 'Honey');
  await expect(item(page, 'Honey').locator('.badge')).toHaveText('new');
  await ctx.close();
});

test('copy items to another ID', async ({ page, browser }) => {
  const id = await createList(page, 'Home');
  await add(page, 'Soap');
  const ctx2 = await browser.newContext({ locale: 'en-US' });
  const other = await ctx2.newPage();
  const otherId = await createList(other, 'Office', 'Work');
  await page.getByRole('button', { name: 'Edit Soap' }).click();
  await page.getByRole('button', { name: 'Copy/move' }).click();
  await page.getByLabel('Other ID').fill(otherId);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.locator('.themeswitch.mode').getByRole('button', { name: 'Move' }).click();
  await page.locator('.panel').getByRole('button', { name: 'Move' }).last().click();
  await expect(other.getByRole('checkbox', { name: 'Soap' })).toBeVisible();
  await expect(item(page, 'Soap')).toHaveCount(0);
  expect(id).not.toBe(otherId);
  await ctx2.close();
});

test('language can be switched per device', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Liste erzeugen' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Liste erzeugen' })).toBeVisible();
});

test('rename this device in the settings; long names are shortened', async ({ page, browser }) => {
  const id = await createList(page);
  const { page: b, ctx } = await join(browser, id, 'Jana');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  const name = page.locator('.panel').getByLabel('Your device name');
  await expect(name).toHaveValue('Alex');
  await name.fill('Dennis-Laptop-in-the-kitchen');
  await name.press('Enter');
  await page.keyboard.press('Escape');
  await expect(b.locator('.person', { hasText: 'Dennis-Laptop' })).toBeVisible();
  const pname = page.locator('.person.me .pname');
  const overflow = await pname.evaluate((el) => getComputedStyle(el).textOverflow);
  expect(overflow).toBe('ellipsis');
  const box = await page.locator('.person.me').boundingBox();
  expect(box.width).toBeLessThanOrEqual(171);
  await ctx.close();
});

test('inactive items: clear checked parks them, tap brings them back', async ({ page }) => {
  await createList(page);
  await add(page, 'Milk');
  await add(page, 'Bread');
  await page.getByRole('checkbox', { name: 'Milk' }).click();
  await page.getByRole('button', { name: 'Move 1 checked item to inactive' }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toHaveCount(0);
  await expect(page.locator('.progress .count')).toHaveText('0 / 1');

  await page.getByRole('button', { name: /Inactive items/ }).click();
  await expect(page.locator('.shadow .item', { hasText: 'Milk' })).toBeVisible();
  // add something only for later
  await page.getByPlaceholder('Add for later, e.g. Baking powder').fill('Baking powder');
  await page.getByPlaceholder('Add for later, e.g. Baking powder').press('Enter');
  await expect(page.locator('.shadow .item', { hasText: 'Baking powder' })).toBeVisible();
  await expect(page.locator('.progress .count')).toHaveText('0 / 1');

  // tap → back on the list
  await page.getByRole('button', { name: 'Put Milk back on the list' }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toHaveAttribute('aria-checked', 'false');
  // typing an inactive item's name re-activates it instead of duplicating
  await add(page, 'baking powder');
  await expect(page.getByRole('checkbox', { name: 'Baking powder' })).toBeVisible();
  await expect(page.locator('.shadow .item')).toHaveCount(0);
});

test('export as Markdown and import with duplicate check', async ({ page }) => {
  await createList(page, 'Home');
  await add(page, '2 Milk');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Backup & import' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download all lists (.md)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^shopwiz-home-\d{4}-\d{2}-\d{2}\.md$/);
  const fs = await import('node:fs/promises');
  const md = await fs.readFile(await download.path(), 'utf8');
  expect(md).toContain('# Home');
  expect(md).toContain('- [ ] 2 Milk');

  // edit the file "by hand" and import it into the same ID
  const edited = `${md}### Bakery\n- [ ] Bread\n- [-] Croissants\n`;
  await page.getByLabel('…or paste text').fill(edited);
  await expect(page.locator('.hint', { hasText: 'Found 3 items' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 items' }).click();
  await expect(page.getByText('Import done: 2 added, 0 re-activated, 1 already there')).toBeVisible();
  await expect(page.locator('.group', { hasText: 'Bakery' }).getByRole('checkbox', { name: 'Bread' })).toBeVisible();
  await expect(page.locator('.item', { hasText: 'Milk' })).toHaveCount(1);
});

test('import a plain text file as a new ID from the start screen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import a file as a new list' }).click();
  await page.getByRole('button', { name: 'Yes, continue' }).click(); // suggested device name kept
  await page.locator('input[type=file]').setInputFiles({ name: 'party.txt', mimeType: 'text/plain', buffer: Buffer.from('Chips\n2 Cola\nNapkins // white\n') });
  await expect(page.locator('.hint', { hasText: 'Found 3 items' })).toBeVisible();
  await page.getByRole('button', { name: 'Import 3 items' }).click();
  await page.waitForURL(ID_URL);
  await expect(page.locator('.list-title')).toContainText('party');
  await expect(page.getByRole('checkbox', { name: 'Cola' })).toBeVisible();
  await expect(page.locator('.item', { hasText: 'Napkins' })).toContainText('white');
});

test('+/- next to the amount on wide screens only', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await createList(page);
  await add(page, 'Eggs');
  await add(page, '500g Flour');
  await page.getByRole('button', { name: 'One more Eggs' }).click();
  await page.getByRole('button', { name: 'One more Eggs' }).click();
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('3×');
  await page.getByRole('button', { name: 'One less Eggs' }).click();
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('2×');
  await page.getByRole('button', { name: 'One more Flour' }).click();
  await expect(item(page, 'Flour').locator('.amount')).toHaveText('600 g');
  await page.reload();
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('2×');
  // phones: no buttons, the amount stays visible
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'One more Eggs' })).toBeHidden();
  await expect(item(page, 'Eggs').locator('.amount')).toHaveText('2×');
});

test('groups without items move to the inactive part and come back with their items', async ({ page }) => {
  await createList(page);
  await page.getByRole('button', { name: 'Add group' }).last().click();
  await page.getByLabel('Name').fill('Bakery');
  await page.getByRole('button', { name: 'Create' }).click();
  await add(page, 'Bread');
  const active = page.locator('.sheet .group', { hasText: 'Bakery' });
  await expect(active).toBeVisible();
  // checked items stay on the list, so the group stays
  await page.getByRole('checkbox', { name: 'Bread' }).click();
  await expect(active).toBeVisible();
  // clearing moves the last item to inactive → the group follows
  await page.getByRole('button', { name: 'Move 1 checked item to inactive' }).click();
  await expect(active).toHaveCount(0);
  await page.getByRole('button', { name: /Inactive items/ }).click();
  const shadowGroup = page.locator('.shadow .s-group', { hasText: 'Bakery' });
  await expect(shadowGroup.locator('.item', { hasText: 'Bread' })).toBeVisible();
  // an empty group shows up in the inactive part, too
  await page.getByRole('button', { name: 'Add group' }).last().click();
  await page.getByLabel('Name').fill('Drinks');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'Back to automatic group' }).click();
  const drinks = page.locator('.shadow .s-group', { hasText: 'Drinks' });
  await expect(drinks.locator('ul.items')).toHaveAttribute('data-empty', /^Empty/);
  await expect(drinks.locator('.item')).toHaveCount(0);
  // bringing Bread back re-activates Bakery
  await page.getByRole('button', { name: 'Put Bread back on the list' }).click();
  await expect(active.getByRole('checkbox', { name: 'Bread' })).toBeVisible();
  await expect(page.locator('.shadow .s-group', { hasText: 'Bakery' })).toHaveCount(0);
});

test('a list address shows a navigation button', async ({ page }) => {
  await createList(page, 'Conad');
  await expect(page.locator('.nav-btn')).toHaveCount(0);
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByLabel('Shop address (optional)').fill('Conad, Via Roma 1, Olbia');
  await page.getByRole('button', { name: 'Close' }).click();
  const nav = page.getByRole('link', { name: /Start navigation/ });
  await expect(nav).toHaveAttribute('href', /destination=Conad%2C%20Via%20Roma%201%2C%20Olbia/);
  await expect(nav.locator('.nav-label')).toBeHidden(); // phone width: arrow only
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(nav.locator('.nav-label')).toBeVisible();
});

test('find each other in the shop: spot, call, answer, all done', async ({ page, browser }) => {
  const id = await createList(page);
  await page.getByRole('button', { name: 'Add group' }).last().click();
  await page.getByLabel('Name').fill('Bakery');
  await page.getByRole('button', { name: 'Create' }).click();
  await add(page, 'Bread');
  await add(page, 'Rolls');
  await page.getByRole('button', { name: 'Back to automatic group' }).click();
  await add(page, 'Milk');
  const { page: b, ctx } = await join(browser, id, 'Jana');

  // the call button only appears when I'm checked in and somebody else is, too
  await page.getByRole('button', { name: "I'm shopping" }).click();
  await expect(page.getByRole('button', { name: 'Call' })).toHaveCount(0);
  await b.getByRole('button', { name: "I'm shopping" }).click();
  await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();

  // Alex checks Bread → Jana sees where Alex is
  await page.getByRole('checkbox', { name: 'Bread' }).click();
  await expect(b.locator('.hint', { hasText: 'Alex' })).toContainText('at Bakery');

  // Jana: "Where are you?" → Alex answers with one tap
  await b.getByRole('button', { name: 'Call' }).click();
  await b.getByRole('button', { name: 'Where are you?' }).click();
  await expect(page.locator('.signal')).toContainText('Jana is looking for you');
  await page.getByRole('button', { name: 'I\'m at Bakery' }).click();
  await expect(b.locator('.signal')).toContainText('Alex is at Bakery (last: Bread)');
  await b.locator('.signal').getByRole('button', { name: 'OK' }).click();
  await expect(b.locator('.signal')).toHaveCount(0);

  // "Come to me" from Alex to Jana only
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Call' }).click();
  await page.locator('.panel').getByRole('button', { name: 'Jana' }).click();
  await page.getByRole('button', { name: 'Come to me – Bakery' }).click();
  await expect(b.locator('.signal')).toContainText('Alex is waiting at Bakery');
  await b.locator('.signal').getByRole('button', { name: 'OK' }).click();

  // Jana's display goes off – the call waits and arrives when ShopWiz is open again
  await b.close();
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Call' }).click();
  await page.getByRole('button', { name: 'Meet at the checkout' }).click();
  const b2 = await ctx.newPage();
  await b2.goto(`/${id}`);
  await expect(b2.locator('.signal')).toContainText('Alex: meet at the checkout');
  await b2.locator('.signal').getByRole('button', { name: 'OK' }).click();

  // Jana checks the rest → Alex gets "everything is in the cart"
  await b2.getByRole('checkbox', { name: 'Rolls' }).click();
  await b2.getByRole('checkbox', { name: 'Milk' }).click();
  await expect(page.locator('.signal')).toContainText('Everything is in the cart');
  await ctx.close();
});

test('help: visible on the start screen and in the header, one-time hint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'How ShopWiz works' }).click();
  await page.getByRole('button', { name: 'Adding items' }).click();
  await expect(page.locator('.panel')).toContainText('Amounts are recognised');
  await page.keyboard.press('Escape');

  await createList(page);
  const hint = page.locator('.help-hint');
  await expect(hint).toContainText('New here?');
  await hint.getByRole('button', { name: 'Open guide' }).click();
  await expect(page.getByRole('dialog', { name: 'How ShopWiz works' })).toBeVisible();
  await page.getByRole('button', { name: 'Shopping together' }).click();
  await expect(page.locator('.panel')).toContainText('Call');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.list-title')).toBeVisible();
  await expect(hint).toHaveCount(0); // only once
  await page.getByRole('button', { name: 'How ShopWiz works' }).click();
  await expect(page.getByRole('button', { name: 'Privacy' })).toBeVisible();
  // about: version and a link to the source code
  await expect(page.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute('href', /github\.com\//);
  await expect(page.locator('.about')).toContainText('Version');
});

test('keeping the suggested device name asks once before creating', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Name of the list').fill('Weekly');
  const suggested = await page.getByLabel('Your device name').inputValue();
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.getByRole('dialog', { name: `Continue as “${suggested}”?` })).toBeVisible();
  // change it → no further question
  await page.getByRole('button', { name: 'Change name' }).click();
  await expect(page.getByLabel('Your device name')).toBeFocused();
  await page.getByLabel('Your device name').fill('Kim');
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.waitForURL(ID_URL);
  await page.getByRole('button', { name: 'Participants' }).click();
  await expect(page.locator('.panel input')).toHaveValue('Kim');
});

test('the suggested device name can be confirmed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Name of the list').fill('Weekly');
  await page.getByRole('button', { name: 'Create list' }).click();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await page.waitForURL(ID_URL);
  await expect(page.locator('.list-title')).toContainText('Weekly');
});

test('the ID field is a password field that password managers can fill', async ({ page, browser }) => {
  const id = await createList(page);
  const ctx = await browser.newContext({ locale: 'en-US' });
  const p2 = await ctx.newPage();
  await p2.goto('/');
  const field = p2.getByLabel('10-character ID', { exact: true });
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'current-password');
  await expect(p2.locator('input[autocomplete="username"]')).toHaveCount(1);
  await field.fill(id.toLowerCase());
  await p2.getByRole('button', { name: 'Show ID' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveValue(`${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`);
  await p2.getByRole('button', { name: 'Open list' }).click();
  await p2.getByRole('button', { name: 'Yes, continue' }).click();
  await expect(p2.locator('.list-title')).toContainText('Weekly');
  await ctx.close();
});

test('settings show the ID masked, reveal and copy it', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const id = await createList(page);
  const formatted = `${id.slice(0, 4)}-${id.slice(4, 8)}-${id.slice(8)}`;
  await page.getByRole('button', { name: 'Settings' }).click();
  const chip = page.locator('.id-chip');
  await expect(chip).not.toContainText(formatted);
  await page.getByRole('button', { name: 'Show ID' }).click();
  await expect(chip).toContainText(formatted);
  await chip.click();
  await expect(page.locator('.toast', { hasText: 'ID copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(formatted);
  await ctx.close();
});

test('dragging a group drops it where it is let go, also past empty groups', async ({ page }) => {
  await createList(page);
  const group = async (name, itemName) => {
    await page.getByRole('button', { name: 'Add group' }).last().click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    if (itemName) await add(page, itemName);
  };
  await group('Bakery', 'Bread');
  await group('Empty'); // no items → waits under "inactive", not shown above
  await group('Fridge', 'Milk');
  await group('Drinks', 'Water');
  const names = () => page.locator('.groups .group.top > header .name').allTextContents();
  await expect.poll(names).toEqual(['Bakery', 'Fridge', 'Drinks']);

  // Bakery to between Fridge and Drinks
  const fridge = await page.locator('.group.top', { hasText: 'Fridge' }).boundingBox();
  const h = await page.locator('.group.top', { hasText: 'Bakery' }).locator('.g-handle').boundingBox();
  const x = h.x + h.width / 2;
  await page.mouse.move(x, h.y + h.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  // SortableJS needs real, gradual pointer moves
  for (let y = h.y + h.height / 2; y < fridge.y + fridge.height + 6; y += 8) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect.poll(names).toEqual(['Fridge', 'Bakery', 'Drinks']);
});

test('travel mode: country from the address, bulk translation, own corrections, show to staff', async ({ page }) => {
  await createList(page);
  await add(page, 'Milch');
  await add(page, '2 Brot');
  await add(page, 'Käse');

  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByLabel('Shop address (optional)').fill('Via Roma 3, 07026 Olbia, Italia');
  await page.getByRole('checkbox', { name: /Show items in the local language/ }).check();
  await expect(page.locator('.travel-now')).toContainText('Italy · Italian');
  await page.getByRole('button', { name: 'Translate 3 items' }).click();
  await expect(page.locator('.toast', { hasText: '3 items translated.' })).toBeVisible();
  await expect(page.getByText('Every item has a translation.')).toBeVisible();
  await expect(page.locator('.travel')).toContainText('Translated with LibreTranslate.');
  await page.getByRole('button', { name: 'Close' }).first().click();

  // under each item: flag + translation
  await expect(item(page, 'Milch').locator('.tr')).toHaveText('Latte');
  await expect(item(page, 'Brot').locator('.tr')).toHaveText('Pane');
  await expect(item(page, 'Milch').locator('.tr img.flag')).toHaveCount(1);

  // correct a machine translation in the item details
  await page.getByRole('button', { name: 'Edit Käse' }).click();
  await expect(page.getByText('Machine translation by LibreTranslate')).toBeVisible();
  await page.getByLabel('Translation · Italian').fill('Formaggio');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(item(page, 'Käse').locator('.tr')).toHaveText('Formaggio');

  // "Translate" asks the service again; kept as is it stays a machine translation
  await page.getByRole('button', { name: 'Edit Milch' }).click();
  await page.getByRole('button', { name: 'Translate' }).click();
  await expect(page.getByText('Just translated by LibreTranslate')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Edit Milch' }).click();
  await expect(page.getByText('Machine translation by LibreTranslate')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Edit Käse' }).click();
  await expect(page.getByText('Typed in by hand.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // show it big to the staff, step to the next item
  await item(page, 'Milch').locator('.tr').click();
  const show = page.getByRole('dialog', { name: 'Translation for the staff' });
  await expect(show.locator('.big')).toHaveText('Latte');
  await show.getByRole('button', { name: 'Next item' }).click();
  await expect(show.locator('.big')).toHaveText('Pane');
  await expect(show.locator('.amount')).toHaveText('2×');
  await page.keyboard.press('Escape');
  await expect(show).toHaveCount(0);

  // delete the list's translations (after asking) → everything can be translated again
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: 'Delete 3 translations of this list' }).click();
  await page.locator('.travel').getByRole('button', { name: 'Delete 3 translations of this list' }).click();
  await expect(page.getByRole('button', { name: 'Translate 3 items' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.locator('.item .tr')).toHaveCount(0);

  // the service is named in the help
  await page.getByRole('button', { name: 'How ShopWiz works' }).first().click();
  await expect(page.locator('.services')).toContainText('Translation:');
  await expect(page.locator('.services .svc')).toHaveText('LibreTranslate');
  await expect(page.locator('.services .dot.ok')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // the flags' license ships with the app
  // every third-party package in the bundle, with its license text
  const licenses = await (await page.request.get('/licenses.txt')).text();
  for (const name of ['flag-icons', 'svelte', 'qrcode', 'jsqr', 'sortablejs', '@fontsource/instrument-sans', '@fontsource/ibm-plex-mono']) expect(licenses).toContain(`- ${name} `);
  expect(licenses).toContain('SIL Open Font License');
  expect(licenses).toContain('Apache License');
});

test('important / not important: shortcut, add-bar button, details, display style', async ({ page }) => {
  await createList(page);
  // shortcuts are off by default – "!" stays part of the name
  await add(page, '!Exclamation');
  await expect(item(page, '!Exclamation')).toHaveCount(1);

  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('checkbox', { name: /Shortcuts “!” and “\?” when adding/ }).check();
  await page.getByRole('button', { name: 'Close' }).first().click();

  // with and without the space phone keyboards put after "!"
  await add(page, '!Diapers');
  await add(page, '! Milk');
  await add(page, '? Basil');
  await expect(item(page, 'Diapers')).toHaveClass(/prio-up/);
  await expect(item(page, 'Milk')).toHaveClass(/prio-up/);
  await expect(item(page, 'Basil')).toHaveClass(/prio-down/);
  await expect(item(page, 'Diapers').locator('.box .prio-in')).toHaveCount(1); // default: arrow in the box

  // the add-bar button shows what the typed mark does, and can be used instead
  const input = page.getByPlaceholder('Add item, e.g. 2 milk');
  await input.fill('!');
  await input.pressSequentially('Bread');
  await expect(page.locator('.prio-pick')).toHaveText('Important');
  await input.fill('');
  await page.locator('.prio-pick').click();
  await expect(page.locator('.prio-pick')).toHaveText('Important');
  await input.fill('Apples');
  await input.press('Enter');
  await expect(item(page, 'Apples')).toHaveClass(/prio-up/);
  await expect(page.locator('.prio-pick')).toHaveText('Normal'); // back to normal for the next one

  // details: three choices under the amount
  await page.getByRole('button', { name: 'Edit Basil' }).click();
  await page.getByRole('radio', { name: 'Normal' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(item(page, 'Basil')).not.toHaveClass(/prio-/);

  // display style per device
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Arrow on the box corner' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-prio', 'badge');
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(item(page, 'Diapers').locator('.prio-mark')).toBeVisible();
});

test('AI assistant: connect, read only until allowed, its items appear live, remove it', async ({ page }) => {
  await createList(page, 'Weekly');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('AI assistants')).toBeVisible();
  await page.getByRole('button', { name: 'Claude', exact: true }).click();
  await expect(page.getByText('Claude is connected.')).toBeVisible();
  const url = (await page.locator('.copyline span').first().textContent()).trim();
  expect(url).toMatch(/\/mcp\/swk_/);
  const key = url.split('/mcp/')[1];
  await page.getByRole('button', { name: 'Done' }).click();

  // read only by default
  let r = await page.request.post('/api/v1/lists/default/items', { headers: { authorization: `Bearer ${key}` }, data: { items: ['Milk'] } });
  expect(r.status()).toBe(403);
  await page.getByRole('checkbox', { name: /Assistants may change lists/ }).check();
  await expect(page.getByText(/On: assistants can add/)).toBeVisible();
  await page.waitForTimeout(300);
  r = await page.request.post('/api/v1/lists/default/items', { headers: { authorization: `Bearer ${key}` }, data: { text: '2 milk and bread' } });
  expect(r.status()).toBe(200);
  await page.getByRole('button', { name: 'Close' }).first().click();
  await expect(item(page, 'milk')).toBeVisible();
  await expect(item(page, 'bread')).toBeVisible();

  // shows up as a participant and can be removed – the key stops working
  await page.getByRole('button', { name: 'Participants' }).click();
  await expect(page.locator('ul.people')).toContainText('Claude');
  await page.getByRole('button', { name: 'Remove Claude' }).click();
  await page.locator('ul.people').getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('ul.people')).not.toContainText('Claude');
  r = await page.request.get('/api/v1/lists', { headers: { authorization: `Bearer ${key}` } });
  expect(r.status()).toBe(401);
});

test('shopping tools: important first, hide checked, search, share as text, finish shopping', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8098' });
  await createList(page);
  await add(page, 'Milk');
  await add(page, 'Bread');
  await add(page, '2 Eggs');
  // important items go to the top of their group
  await page.getByRole('button', { name: 'Edit Eggs' }).click();
  await page.getByRole('radio', { name: 'Important', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.ungrouped .item .name')).toHaveText(['Eggs', 'Milk', 'Bread']);

  // hide checked items (per device)
  await page.getByRole('checkbox', { name: 'Milk' }).click();
  await page.getByRole('button', { name: 'Hide checked items' }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 1 checked' }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toBeVisible();

  // search, inactive items included
  await page.getByRole('button', { name: 'Edit Bread' }).click();
  await page.getByRole('button', { name: 'Not needed now' }).click();
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByRole('searchbox', { name: 'Search' }).fill('BRE');
  await expect(page.locator('.item .name')).toHaveText(['Bread']);
  await expect(page.locator('.shadow .item', { hasText: 'Bread' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search' }).fill('xyz');
  await expect(page.getByText('Nothing found for “xyz”.')).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.locator('.sheet .item .name')).toHaveText(['Eggs', 'Milk']);
  await page.getByRole('button', { name: /Inactive items/ }).click();
  await page.getByRole('button', { name: 'Put Bread back on the list' }).click();

  // share the open items as text, one per line
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { value: undefined }));
  await page.getByRole('button', { name: 'List options' }).click();
  await page.getByRole('button', { name: 'Share as text' }).click();
  await expect(page.locator('.toast', { hasText: 'List copied as text.' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Weekly\n\n2× Eggs\nBread');
  await page.getByRole('button', { name: 'Close' }).first().click();

  // everything checked → finish: checked items become inactive, check-in ends
  await page.getByRole('button', { name: "I'm shopping" }).click();
  await page.getByRole('checkbox', { name: 'Eggs' }).click();
  await page.getByRole('checkbox', { name: 'Bread' }).click();
  await expect(page.locator('.toast', { hasText: 'Everything checked!' })).toBeVisible();
  await page.locator('.done-card').getByRole('button', { name: 'Finish shopping' }).click();
  await expect(page.locator('.progress .count')).toHaveText('0 / 0');
  await expect(page.getByRole('button', { name: "I'm shopping" })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.toast', { hasText: '3 items are inactive now' })).toBeVisible();
  await expect(page.locator('.done-card')).toHaveCount(0);

  // help knows about AI assistants
  await page.getByRole('button', { name: 'How ShopWiz works' }).click();
  await page.getByRole('button', { name: 'AI assistants' }).click();
  await expect(page.locator('.topic.open')).toContainText('Claude, ChatGPT, Grok or Siri');
});

test('swipe: direction per device, check off, inactive with undo, off', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: true });
  const page = await ctx.newPage();
  await createList(page);
  await add(page, 'Milk');
  await add(page, 'Bread');
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (name, dx) => {
    const box = await item(page, name).locator('.name').boundingBox();
    const y = box.y + box.height / 2;
    const x = 195 - dx / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  // default: right checks off, left makes inactive
  await swipe('Milk', 200);
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toHaveAttribute('aria-checked', 'true');
  await swipe('Bread', -200);
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveCount(0);
  await page.locator('.toast', { hasText: 'Bread is inactive now.' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'false');
  // a short swipe does nothing
  await swipe('Bread', 40);
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Swipe left to check, right to make inactive' }).click();
  await page.getByRole('button', { name: 'Close' }).first().click();
  await swipe('Milk', -200);
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Swiping off' }).click();
  await page.getByRole('button', { name: 'Close' }).first().click();
  await swipe('Milk', -200);
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toHaveAttribute('aria-checked', 'false');
  await ctx.close();
});

test('installed app: system bars follow the phone, not the skin, so the navigation buttons fit the bar', async ({ browser }) => {
  // phone in dark mode, ShopWiz set to light – pretend to run from the home screen
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', colorScheme: 'dark' });
  await ctx.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { ...real(q), matches: true, media: q } : real(q));
  });
  const page = await ctx.newPage();
  await createList(page);
  const barColor = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  expect(await barColor()).toBe('#101714');
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.getByRole('button', { name: 'Focus mode' }).click();
  expect(await barColor()).toBe('#000000');
  await ctx.close();
});

test('focus mode: only the list, tap or swipe there, stays on until left', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', hasTouch: true });
  const page = await ctx.newPage();
  await createList(page);
  await page.getByRole('button', { name: 'Add group' }).last().click();
  await page.getByLabel('Name').fill('Bakery');
  await page.getByRole('button', { name: 'Create' }).click();
  await add(page, 'Bread');
  await page.getByRole('button', { name: 'Back to automatic group' }).click();
  await add(page, '2 Milk');
  await add(page, 'Tea');
  const barColor = () => page.locator('meta[name="theme-color"]').getAttribute('content');
  expect(await barColor()).toBe('#e9ede6');
  await page.getByRole('button', { name: 'Focus mode' }).click();
  const focus = page.getByRole('dialog', { name: 'Weekly – focus mode' });
  await expect(focus.locator('h2')).toHaveText(['Bakery']);
  await expect(focus.getByRole('checkbox')).toHaveText(['2× Milk', 'Tea', 'Bread']);
  // status / navigation bar in the focus mode's white
  expect(await barColor()).toBe('#ffffff');
  await focus.getByRole('checkbox', { name: 'Bread' }).click();
  await expect(focus.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'true');

  // swiping works here, too: right checks off, left makes inactive
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (name, dx) => {
    const box = await focus.getByRole('checkbox', { name }).boundingBox();
    const y = box.y + box.height / 2;
    const x = 195 - dx / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe('Milk', 200);
  await expect(focus.getByRole('checkbox', { name: 'Milk' })).toHaveAttribute('aria-checked', 'true');
  await swipe('Tea', -200);
  await expect(focus.getByRole('checkbox', { name: 'Tea' })).toHaveCount(0);

  await page.reload();
  await expect(focus).toBeVisible();
  await focus.getByRole('button', { name: 'Leave focus mode' }).click();
  await expect(focus).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'true');
  // the app's own dark choice colors the bars, too – not only the system setting
  expect(await barColor()).toBe('#e9ede6');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  expect(await barColor()).toBe('#101714');
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  // no theme_color in the manifest: Android then colors the installed app's navigation bar after the phone
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.theme_color).toBeUndefined();
  await ctx.close();
});

test('skins: the browser decides until one is picked, then the pick stays', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // first visit, dark browser: the standard dark skin, nothing saved
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'auto');
  expect(await bg()).toBe('rgb(16, 23, 20)');
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toHaveAttribute('aria-checked', 'true');
  // start screen: one dot per skin
  await page.getByRole('radio', { name: 'AMOLED' }).click();
  expect(await bg()).toBe('rgb(0, 0, 0)');
  await createList(page);
  // settings: preview tiles in the skins' own colors
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'AMOLED' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Mango' }).click();
  expect(await bg()).toBe('rgb(255, 223, 158)');
  expect(await page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#ffdf9e');
  const tileBg = await page.locator('.tile[data-skin="amoled"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(tileBg).toBe('rgb(0, 0, 0)');
  // the pick survives a reload, whatever the browser says
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mango');
  await ctx.close();
});
