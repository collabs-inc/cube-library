// Creates ~/Mind (or MIND_HOME) the first time the app is installed, with a few cards so the grid isn't empty. An
// existing folder is never changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STATE = path.resolve(process.env.MIND_STATE || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'cube-mind'));
let settings = {}; try { settings = JSON.parse(fs.readFileSync(path.join(STATE, 'settings.json'), 'utf8')); } catch {}
const HOME = path.resolve(String(process.env.MIND_HOME || settings.home || path.join(os.homedir(), 'Mind')).replace(/^~(?=$|\/)/, os.homedir()));
fs.mkdirSync(STATE, { recursive: true });
if (fs.existsSync(HOME)) { console.log(`mind: ${HOME} already exists; left as it is`); process.exit(0); }
fs.cpSync(path.join(APP, 'starter'), HOME, { recursive: true });
fs.mkdirSync(path.join(HOME, 'assets'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.gitignore'), '.DS_Store\n.trash/\n');
const git = (...a) => execFileSync('git', ['-C', HOME, ...a], { stdio: 'ignore' });
try {
  git('init', '-q', '-b', 'main'); git('add', '-A');
  let who = []; try { execFileSync('git', ['-C', HOME, 'config', 'user.email'], { stdio: 'ignore' }); } catch { who = ['-c', 'user.name=Mind', '-c', 'user.email=mind@cube.invalid']; }
  execFileSync('git', ['-C', HOME, ...who, 'commit', '-q', '-m', 'Start Mind'], { stdio: 'ignore' });
} catch {}
console.log(`mind: created ${HOME}`);
