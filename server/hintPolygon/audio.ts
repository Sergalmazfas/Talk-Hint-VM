/** Local, strict Twilio PCM parser; no dependency on the old benchmark. */
export function mulaw(sample: number) {
  const sign = sample < 0 ? 0x80 : 0;
  sample = Math.min(Math.abs(sample),32635)+0x84;
  let exponent=7;
  for(let mask=0x4000;(sample&mask)===0 && exponent>0;mask>>=1) exponent--;
  return (~(sign | (exponent<<4) | ((sample>>(exponent+3))&15)))&255;
}
export function channels(wav: Buffer) {
  if(wav.length<44 || wav.toString("ascii",0,4)!=="RIFF" || wav.toString("ascii",8,12)!=="WAVE")throw Error("BAD_WAV");
  let n=0, rate=0, fmt=0, bits=0, data:Buffer|undefined;
  for(let off=12;off+8<=wav.length;) {
    const id=wav.toString("ascii",off,off+4),len=wav.readUInt32LE(off+4);
    if(off+8+len>wav.length)throw Error("TRUNCATED_WAV");
    if(id==="fmt "){if(len<16)throw Error("BAD_FMT");fmt=wav.readUInt16LE(off+8);n=wav.readUInt16LE(off+10);rate=wav.readUInt32LE(off+12);bits=wav.readUInt16LE(off+22);}
    if(id==="data")data=wav.subarray(off+8,off+8+len);
    off+=8+len+(len%2);
  }
  if(fmt!==1 || bits!==16 || rate!==8000 || n!==2 || !data || data.length%4)throw Error("NEED_ORIGINAL_8KHZ_DUAL_PCM16");
  const frames=data.length/4, out=[Buffer.alloc(frames),Buffer.alloc(frames)];
  for(let i=0;i<frames;i++) for(let ch=0;ch<2;ch++)out[ch][i]=mulaw(data.readInt16LE(i*4+ch*2));
  return out;
}
