import { spawn } from 'node:child_process';
import process from 'node:process';

export async function commandExists(command) {
  const binary = String(command).trim().split(/\s+/)[0];
  if (!binary) return false;
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    const child = spawn(lookup, [binary], { stdio: 'ignore', windowsHide: true });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

export function parseCommand(command) {
  const tokens = [];
  const input = String(command ?? '').trim();
  let current = '';
  let quote = null;
  let escaped = false;
  for (const character of input) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current) tokens.push(current);
  if (quote) throw new Error('Unterminated quote in DSH command.');
  return tokens;
}
