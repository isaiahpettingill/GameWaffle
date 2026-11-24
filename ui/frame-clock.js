export const TICK_MS=1000/60;
export const MAX_CATCH_UP=3;
const UPDATE_BUDGET_MS=8;
const ROUNDING_MS=1e-6;

export function createFrameClock(clock=()=>performance.now()){
  let last, lag=0;
  return {
    reset(){last=undefined;lag=0;},
    run(now,step){
      lag=Math.min(lag+Math.max(0,now-(last??now)),TICK_MS*MAX_CATCH_UP);
      last=now;
      const deadline=clock()+UPDATE_BUDGET_MS;
      let ran=0;
      while(lag+ROUNDING_MS>=TICK_MS && ran<MAX_CATCH_UP){
        if(ran&&clock()>=deadline || step()===false)break;
        lag=Math.max(0,lag-TICK_MS);
        ran++;
      }
      // Preserve at most one step of debt so the next callback can poll fresh input.
      lag=Math.min(lag,TICK_MS);
      return ran;
    },
  };
}
