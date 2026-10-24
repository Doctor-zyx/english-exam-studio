// Zero-dependency, read-only validation of the exact directory deployed to Pages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const failures = [], warnings = [], stats = {};
const fail = (file, message) => failures.push(`${file}: ${message}`);
const relative = file => path.relative(dist, file).split(path.sep).join('/');
const textExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.md', '.csv', '.svg', '.txt']);

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { fail(relative(full), 'symbolic links are not allowed in the public artifact'); return []; }
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function checkAsset(reference, from='index.html', context='asset') {
  if (typeof reference !== 'string' || !reference.trim()) { fail(from, `${context} has an empty path`); return; }
  if (/^(?:https?:|data:|blob:|mailto:|tel:|#)/i.test(reference)) return;
  if (reference.includes('${') || reference.includes('{{')) return;
  if (reference.startsWith('/') || /^[a-z]:[\\/]/i.test(reference)) { fail(from, `${context} must use a relative path: ${reference}`); return; }
  let clean;
  try { clean = decodeURIComponent(reference.split(/[?#]/)[0]); } catch { fail(from, `${context} contains an invalid URL escape`); return; }
  if (!clean) return;
  const target = path.resolve(path.dirname(path.join(dist, from)), clean);
  const underDist = path.relative(dist, target);
  if (underDist.startsWith('..') || path.isAbsolute(underDist)) { fail(from, `${context} escapes the deployment directory: ${reference}`); return; }
  const actual = fs.existsSync(target) && fs.statSync(target);
  if (!actual) { fail(from, `${context} is missing: ${reference}`); return; }
  if (actual.isDirectory() && !fs.existsSync(path.join(target, 'index.html'))) fail(from, `${context} directory has no index.html: ${reference}`);
}

function readJSON(name) {
  const file = path.join(dist, name);
  if (!fs.existsSync(file)) { fail(name, 'required JSON is missing'); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { fail(name, `invalid JSON: ${error.message}`); return null; }
}

const files = walk(dist);
if (!files.length) fail('dist', 'deployment directory is absent or empty');
stats.files = files.length;
stats.bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
for (const required of ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest', 'icon.svg']) {
  if (!fs.existsSync(path.join(dist, required))) fail(required, 'required app asset is missing');
}

const forbidden = [
  [/\.openai(?:[\\/]|\\\\)|hosting\.json|"project_id"\s*:/i, 'old hosting metadata is present'],
  [/(?:chatgpt\.com|chat\.openai\.com)\/(?:sites|s|g|auth|login)\b/i, 'old hosted-site/login URL is present'],
  [/(?:ChatGPT\s*账号|登录[^\n。]{0,70}ChatGPT|私密网址|私密访问验证)/i, 'old private-login instructions are present'],
  [/[A-Z]:\\{1,2}(?:[\p{L}\p{N} _.-]+\\{1,2})/iu, 'local Windows filesystem path is present'],
  [/sb_secret_[A-Za-z0-9_-]{12,}/, 'server-only Supabase secret key is present'],
  [/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/, 'GitHub access token is present'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key is present']
];
const internalNames = /(?:资料与功能核查|资料写作核查|资料听力核查|部署报告|交付记录|发布记录)/;

for (const file of files) {
  const name = relative(file), ext = path.extname(file).toLowerCase();
  if (name.split('/').some(part => ['.git','.openai','node_modules','test-results','playwright-report'].includes(part) || part==='.env' || part.startsWith('.env.'))) fail(name, 'private or development-only file is in dist');
  if (internalNames.test(name)) fail(name, 'internal handoff/audit record must not be published');
  if (!textExtensions.has(ext)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [pattern, message] of forbidden) if (pattern.test(text)) fail(name, message);
  for (const match of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split('.')[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') fail(name, 'legacy server-only service_role JWT is present');
    } catch { /* Not a parseable JWT; no token contents are printed. */ }
  }
  if (ext === '.html') {
    for (const match of text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) checkAsset(match[1], name, 'HTML reference');
    if (/<base\b[^>]*href\s*=\s*["']\//i.test(text)) fail(name, 'root base URL breaks a repository subpath');
  }
  if (ext === '.css') for (const match of text.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)) checkAsset(match[1], name, 'CSS URL');
  if (ext === '.js' && !/^\s*(?:import|export)\s/m.test(text)) {
    try { new vm.Script(text, {filename:name}); } catch(error) { fail(name, `JavaScript syntax error: ${error.message}`); }
  }
  if (ext === '.js' || ext === '.mjs') {
    if (/(?:fetch|register)\(\s*["'`]\/(?!\/)/.test(text)) fail(name, 'root-relative fetch/service worker URL breaks a repository subpath');
    for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g))checkAsset(match[1],name,'module import');
    if(name==='sw.js') {
      const precache=text.match(/(?:SHELL|ASSETS|PRECACHE|APP_SHELL)\s*=\s*\[([^\]]*)\]/);
      if(precache)for(const item of precache[1].matchAll(/["']([^"']+)["']/g))checkAsset(item[1],name,'precache asset');
    }
  }
}

const manifest = readJSON('manifest.webmanifest');
if (manifest) {
  checkAsset(manifest.start_url || './', 'manifest.webmanifest', 'PWA start URL');
  if (manifest.scope && manifest.scope.startsWith('/')) fail('manifest.webmanifest', 'scope must be relative to the repository URL');
  for (const icon of manifest.icons || []) checkAsset(icon.src, 'manifest.webmanifest', 'PWA icon');
}

const listening = readJSON('data/listening.json');
if (listening) {
  const units = listening.units || [], questions=[], blanks=[];
  if (units.length !== 8) fail('data/listening.json', 'expected all 8 course units');
  for (const unit of units) {
    for (const audio of unit.audio || []) checkAsset(audio.path, 'index.html', `Unit ${unit.id} audio`);
    if (!(unit.audio || []).length) fail('data/listening.json', `Unit ${unit.id} has no audio`);
    for (const passage of unit.passages || []) {
      const qids=(passage.questions || []).map(q=>q.id), bids=(passage.parts || []).filter(p=>p.blank!=null).map(p=>p.blank);
      if (JSON.stringify([...qids].sort()) !== JSON.stringify([...bids].sort())) fail('data/listening.json', `${passage.id} blanks do not match questions`);
      questions.push(...qids); blanks.push(...bids);
    }
  }
  if (questions.length!==121 || new Set(questions).size!==121 || blanks.length!==121) fail('data/listening.json', 'expected 121 unique, matched listening blanks');
  stats.listeningUnits=units.length; stats.listeningBlanks=questions.length;
}
const writing=readJSON('data/writing.json');
if(writing) {
  stats.writingLessons=(writing.lessons || []).length;
  for(const lesson of writing.lessons || []) if(lesson.markdownPath) checkAsset(lesson.markdownPath,'index.html','lesson handout');
}
const vocabulary=readJSON('data/vocabulary.json');
if(vocabulary) {
  const words=vocabulary.words || []; stats.vocabulary=words.length;
  if(words.length<500 || words.length>800)fail('data/vocabulary.json','expected 500–800 entries');
  if(new Set(words.map(w=>w.id)).size!==words.length)fail('data/vocabulary.json','duplicate word IDs');
  if(new Set(words.map(w=>w.english.trim().toLowerCase())).size!==words.length)fail('data/vocabulary.json','duplicate English entries');
  for(const word of words) for(const key of ['id','english','ipa','chinese','source','example','theme']) if(typeof word[key]!=='string'||!word[key].trim())fail('data/vocabulary.json',`${word.id} is missing ${key}`);
}
const mocks=readJSON('data/mocks.json');
if(mocks) {
  stats.mockPapers=(mocks.papers || []).length;
  if(stats.mockPapers!==2)fail('data/mocks.json','expected two mock papers');
  for(const paper of mocks.papers || []) {
    const questions=paper.sections.flatMap(s=>s.questions);
    if(questions.reduce((sum,q)=>sum+q.points,0)!==paper.totalPoints)fail('data/mocks.json',`${paper.id} points do not sum to the total`);
  }
}
const library=readJSON('data/files.json');
if(library) {
  stats.libraryFiles=(library.files || []).length;
  for(const file of library.files || []) checkAsset(file.path,'index.html','library file');
}

// Public configuration may be shipped. This check confirms shape, never backend
// reachability or RLS. Empty values allow a guest build, but not --require-cloud.
const configFile=path.join(dist,'config.js');
let cloudConfigured=false;
if(fs.existsSync(configFile)) {
  try {
    const configSource=fs.readFileSync(configFile,'utf8');
    const urlMatch=configSource.match(/["']?supabaseUrl["']?\s*:\s*(['"])([^'"\r\n]*)\1/);
    const keyMatch=configSource.match(/["']?publishableKey["']?\s*:\s*(['"])([^'"\r\n]*)\1/);
    if(!/window\.STUDY_CLOUD_CONFIG\s*=/.test(configSource)||!urlMatch||!keyMatch)fail('config.js','expected static STUDY_CLOUD_CONFIG with quoted supabaseUrl and publishableKey');
    else {
      const url=urlMatch[2],key=keyMatch[2];
      if(url||key) {
        if(!/^https:\/\/[^/\s]+\/?$/.test(url))fail('config.js','project URL must be an HTTPS origin');
        let keyAllowed=/^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
        if(!keyAllowed)try{keyAllowed=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString('utf8')).role==='anon'}catch{}
        if(!keyAllowed)fail('config.js','only a publishable key or legacy anon key is allowed');
        cloudConfigured=!!url&&keyAllowed;
      }
    }
  } catch(error) { fail('config.js',`cannot inspect public configuration: ${error.message}`); }
}
stats.cloudConfigured=cloudConfigured;
if(!cloudConfigured) {
  const message='Cloud is not configured; account sync has not been connected to a real backend.';
  if(process.argv.includes('--require-cloud'))fail('config.js',message); else warnings.push(message);
}
console.log(JSON.stringify({ok:failures.length===0,stats,failures:[...new Set(failures)],warnings},null,2));
process.exitCode=failures.length?1:0;
