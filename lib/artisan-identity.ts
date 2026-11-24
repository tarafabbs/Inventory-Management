export function artisanIdentity(input: Record<string,unknown>) {
  const text=(value:unknown)=>typeof value==='string'?value.trim():'';
  const gst=text(input.gst_no).toUpperCase();
  const pan=text(input.pan_no).toUpperCase();
  const aadhaar=text(input.aadhaar_no).replace(/\s/g,'');
  if(gst&&!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gst))throw Error('Enter a valid 15-character GST number or leave it blank.');
  if(pan&&!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))throw Error('Enter a valid 10-character PAN or leave it blank.');
  if(aadhaar&&!/^[2-9][0-9]{11}$/.test(aadhaar))throw Error('Enter a 12-digit Aadhaar number or leave it blank.');
  return {gst,pan,aadhaar};
}
