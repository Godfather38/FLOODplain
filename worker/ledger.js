// Future single-writer state prototype. UNBOUND: no route, namespace, alarm or sender.
// Every health update and budget/dedup reservation shares one SQLite transaction.
// A production implementation must fence the old Apps Script sender before activation.
export class ShadowLedger {
  constructor(ctx) {
    this.storage=ctx.storage;
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS shadow_state (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  }
  update(command) {
    return this.storage.transactionSync(()=>{
      const row=this.storage.sql.exec('SELECT body FROM shadow_state WHERE id = 1').toArray()[0];
      const state=row?JSON.parse(row.body):{health:{},reservations:{},budgets:{}};
      const result=transition(state,command);
      this.storage.sql.exec('INSERT INTO shadow_state (id, body) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',JSON.stringify(state));
      return result;
    });
  }
}

export function transition(state, c) {
  if (!Number.isFinite(c.now)) throw Error('Invalid clock');
  if(c.type==='observe') {
    for(const r of c.results) {
      const s=state.health[r.id]||{};
      if(s.checked>c.now) continue;
      if(s.reason!==(r.reason||'')) Object.assign(s,{since:c.now,attempts:0,nextTry:0});
      state.health[r.id]={...s,...r,reason:r.reason||'',checked:c.now};
    }
    return structuredClone(state.health);
  }
  if(c.type==='mock-delivery') {
    const pending=Object.values(state.health).filter(s=>(s.reason||'')!==(s.delivered||'') && (s.attempts||0)<5 && c.now>=(s.nextTry||0)
      && (s.reason || (c.now-s.checked<=300000 && (s.id==='compute'||!state.health.compute?.reason))));
    for(const s of pending) {
      s.attempts=(s.attempts||0)+1;s.nextTry=c.now+Math.min(60,2**s.attempts)*60000;
      if(c.success) s.delivered=s.reason;
    }
    return {mock:true,ids:pending.map(s=>s.id)};
  }
  if(c.type==='reserve') {
    // Only synthetic identifiers accepted; cannot ingest subscriber data in this prototype.
    if(!/^mock-[a-z0-9-]{1,64}$/.test(c.key)||!Number.isInteger(c.limit)||c.limit<0) throw Error('Synthetic reservation required');
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Phoenix',year:'numeric',month:'2-digit',day:'2-digit'}).format(c.now);
    const key=day+':'+c.key;
    if(state.reservations[key]) return {reserved:false,reason:'duplicate'};
    if((state.budgets[day]||0)>=c.limit) return {reserved:false,reason:'budget'};
    state.reservations[key]=true;state.budgets[day]=(state.budgets[day]||0)+1;
    return {reserved:true,mock:true,day};
  }
  throw Error('Unknown shadow command');
}
