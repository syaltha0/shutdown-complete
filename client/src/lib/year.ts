export function yearDays(year: number): string[] {
 const days: string[] = [];
 for(let d = new Date(Date.UTC(year,0,1,12)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate()+1)) days.push(d.toISOString().slice(0,10));
 return days;
}
export const heatLevel = (minutes: number) => minutes <= 0 ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 120 ? 3 : 4;
export function longestStreak(minutes: number[]): number {
 let best=0,run=0;
 for(const n of minutes) { run=n>0?run+1:0; best=Math.max(best,run); }
 return best;
}
