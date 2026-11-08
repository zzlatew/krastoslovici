import POOLS from './pools.json';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}});
const err=(message,status=400)=>json({error:message},status);
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
const rand=()=>crypto.randomUUID();
const sha=async text=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
async function pbkdf2(password,salt){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},k,256));}
const cookie=token=>`session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`;
const clearCookie='session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
async function current(req,env){const token=(req.headers.get('cookie')||'').match(/(?:^|;\s*)session=([a-f0-9-]+)/)?.[1];if(!token)return null;return env.DB.prepare('SELECT users.id,users.email,sessions.id AS sid FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>unixepoch()').bind(await sha(token)).first();}
async function read(req){try{return await req.json()}catch{return null}}
function validGame(s){if(!s||typeof s!=='object'||!['s','m','l'].includes(s.size)||typeof s.pid!=='string'||s.pid.length>80||!Array.isArray(s.grid)||!Array.isArray(s.fill)||!Array.isArray(s.hinted)||s.hinted.length>3||!Number.isFinite(s.elapsed)||s.elapsed<0||s.elapsed>864000||![0,1,2,3].includes(s.hintsLeft))return false;const dims={s:[[9,7]],m:[[10,8]],l:[[11,9],[25,21]]}[s.size];const dim=dims.find(([h,w])=>s.grid.length===h&&s.fill.length===h&&s.grid.every(row=>Array.isArray(row)&&row.length===w)&&s.fill.every(row=>Array.isArray(row)&&row.length===w));if(!dim)return false;return s.grid.length===dim[0]&&s.fill.length===dim[0]&&s.grid.every(row=>Array.isArray(row)&&row.length===dim[1]&&row.every(x=>typeof x==='string'&&x.length===1))&&s.fill.every(row=>Array.isArray(row)&&row.length===dim[1]&&row.every(x=>typeof x==='string'&&x.length<=1));}
function verified(s){if(!validGame(s)||!s.pid.startsWith(s.size+'-'))return false;const n=Number(s.pid.slice(2));const pool=POOLS[s.size]?.[n];if(!Number.isInteger(n)||!pool)return false;const grid=pool.split('|').map(x=>[...x]);return grid.every((row,r)=>row.every((ch,c)=>s.grid[r][c]===ch&&(ch==='#'||s.fill[r][c]===ch)))&&s.hintsLeft===3-s.hinted.length;}
async function api(req,env,path){const method=req.method; if(path==='/api/register'&&method==='POST'||path==='/api/login'&&method==='POST'){
 const b=await read(req),email=String(b?.email||'').trim().toLowerCase(),password=b?.password;
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<10||password.length>256)return err('Въведете валиден имейл и парола от поне 10 символа.');
 let user;if(path==='/api/register'){
  const existing=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();if(existing)return err('Този имейл вече е регистриран.',409);
  const salt=rand(),hash=await pbkdf2(password,salt),id=rand();try{await env.DB.prepare('INSERT INTO users(id,email,salt,password_hash) VALUES(?,?,?,?)').bind(id,email,salt,hash).run();}catch{return err('Неуспешна регистрация.',409)}user={id,email};
 }else{user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();const expected=await pbkdf2(password,user?.salt||'invalid-salt');if(!user||expected!==user.password_hash)return err('Грешен имейл или парола.',401);}
 const token=rand()+rand().replaceAll('-','');await env.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,unixepoch()+2592000)').bind(rand(),user.id,await sha(token)).run();return json({email:user.email},200,{'set-cookie':cookie(token)});
 }
 const user=await current(req,env);if(!user)return err('Моля, влезте в профила си.',401);
 if(path==='/api/me'&&method==='GET')return json({email:user.email});
 if(path==='/api/logout'&&method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(user.sid).run();return json({ok:true},200,{'set-cookie':clearCookie});}
 if(path==='/api/progress'&&method==='GET'){const rows=await env.DB.prepare('SELECT game_json,played_json FROM progress WHERE user_id=?').bind(user.id).first();return json({game:rows?.game_json?JSON.parse(rows.game_json):null,played:rows?.played_json?JSON.parse(rows.played_json):{}});}
 if(path==='/api/progress'&&method==='PUT'){
  const b=await read(req);if(!b||JSON.stringify(b).length>25000||b.game!==null&&!validGame(b.game))return err('Невалиден прогрес.');
  const played=b.played||{};if(typeof played!=='object'||Array.isArray(played)||!['s','m','l'].every(k=>played[k]===undefined||Array.isArray(played[k])&&played[k].length<=200&&played[k].every(Number.isInteger)))return err('Невалидни данни.');
  await env.DB.prepare('INSERT INTO progress(user_id,game_json,played_json,updated_at) VALUES(?,?,?,unixepoch()) ON CONFLICT(user_id) DO UPDATE SET game_json=excluded.game_json,played_json=excluded.played_json,updated_at=excluded.updated_at').bind(user.id,JSON.stringify(b.game),JSON.stringify(played)).run();return json({ok:true});
 }
 if(path==='/api/complete'&&method==='POST'){
  const b=await read(req),s=b?.game;if(!verified(s)||!s.done)return err('Този резултат не може да бъде потвърден.',422);
  const seconds=Math.floor(s.elapsed);if(seconds<1)return err('Невалидно време.');
  const result=await env.DB.prepare('INSERT OR IGNORE INTO completions(id,user_id,puzzle_id,size,seconds,hints_used) VALUES(?,?,?,?,?,?)').bind(rand(),user.id,s.pid,s.size,seconds,3-s.hintsLeft).run();return json({ok:true,recorded:result.meta.changes>0});
 }
 if(path==='/api/stats'&&method==='GET'){const row=await env.DB.prepare('SELECT COUNT(*) AS solved, MIN(seconds) AS best_seconds, ROUND(AVG(seconds)) AS avg_seconds FROM completions WHERE user_id=?').bind(user.id).first();return json(row);}
 return err('Няма такъв API адрес.',404);
}
export default {async fetch(req,env){const url=new URL(req.url);if(url.pathname.startsWith('/api/')){try{return await api(req,env,url.pathname)}catch(e){console.error(e);return err('Вътрешна грешка.',500)}}return env.ASSETS.fetch(req);}};
