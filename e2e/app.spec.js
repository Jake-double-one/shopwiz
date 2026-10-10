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

  // group + subgroup
  await page.getByRole('button', { name: 'Add group' }).last().click();
  await page.getByLabel('Name').fill('Fridge');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: 'Options for Fridge' }).click();
  await page.getByRole('button', { name: 'Add subgroup' }).click();
  await page.getByLabel('Name').fill('Dairy');
  await page.getByRole('button', { name: 'Create' }).click();

  // move Milk to Fridge › Dairy
  await page.getByRole('button', { name: 'Edit Milk' }).click();
  await page.locator('.panel').getByLabel('Group').selectOption({ label: 'Fridge › Dairy' });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.group.sub', { hasText: 'Dairy' }).getByRole('checkbox', { name: 'Milk' })).toBeVisible();

  // remove and add again → learned placement
  await page.getByRole('button', { name: 'Edit Milk' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(item(page, 'Milk')).toHaveCount(0);
  await page.getByPlaceholder('Add item, e.g. 2 milk').fill('milk');
  await expect(page.locator('#add-target option').first()).toHaveText('→ Fridge › Dairy');
  await page.getByPlaceholder('Add item, e.g. 2 milk').press('Enter');
  await expect(page.locator('.group.sub', { hasText: 'Dairy' }).getByRole('checkbox', { name: 'milk' })).toBeVisible();

  // survives a reload (state comes from server)
  await page.reload();
  await expect(page.locator('.group.sub', { hasText: 'Dairy' }).getByRole('checkbox', { name: 'milk' })).toBeVisible();
});

test('two devices sync, duplicates, autocomplete and history', async ({ page, browser }) => {
  const id = await createList(page);
  await add(page, 'Bread');
  const { page: b, ctx } = await join(browser, id, 'Jana');
  await expect(page.locator('.person', { hasText: 'Jana' }).locator('.dot.on')).toBeVisible();

  await b.getByRole('checkbox', { name: 'Bread' }).click();
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveAttribute('aria-checked', 'true');
  await expect(item(page, 'Bread')).toContainText('✓ Jana');
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
