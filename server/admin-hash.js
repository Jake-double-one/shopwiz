// Creates the value for ADMIN_PASSWORD_HASH:
//   docker run --rm -it ghcr.io/jake-double-one/shopwiz node server/admin-hash.js
//   (or: echo -n 'my password' | node server/admin-hash.js)
import { createInterface } from 'node:readline';
import { hashPassword } from './password.js';

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // don't echo what is typed
  rl._writeToOutput = (s) => {
    if (s.includes(question)) process.stdout.write(s);
  };
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return s.replace(/\r?\n$/, '');
}

let password;
if (process.stdin.isTTY) {
  password = await ask('Admin password: ');
  if ((await ask('Repeat: ')) !== password) {
    console.error('The passwords are not the same.');
    process.exit(1);
  }
} else {
  password = await readStdin();
}
if (password.length < 12) {
  console.error('Please use at least 12 characters.');
  process.exit(1);
}
console.log(`\nADMIN_PASSWORD_HASH=${await hashPassword(password)}`);
