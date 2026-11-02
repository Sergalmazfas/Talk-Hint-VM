// Keep short smoke tests short; for a full corpus, start long recordings first
// so the final ten-minute recording does not run alone after other slots empty.
export function selectBatch<T extends {durationMs:number}>(items:T[],limit:number):T[] {
  const selected=items.slice(0,limit);
  return limit>3?selected.sort((a,b)=>b.durationMs-a.durationMs):selected;
}

/** Several independent 1x clocks, not one accelerated audio stream. */
export async function runQueue<T>(items:T[],concurrency:number,work:(item:T)=>Promise<void>,stop:()=>boolean=()=>false) {
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>6)throw Error("INVALID_CONCURRENCY");
  let next=0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(!stop()){
      const index=next++;
      if(index>=items.length)return;
      await work(items[index]);
    }
  }));
}
