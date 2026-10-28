/** A claimed notification is attempted once. Unknown delivery must not auto-retry. */
export async function deliverSecretaryNotificationOnce(
  deliver:()=>Promise<void>, markSent:()=>Promise<void>, markUnknown:()=>Promise<void>,
  onError:(error:unknown)=>void,
):Promise<boolean>{
  try { await deliver(); await markSent(); return true; }
  catch(error){ onError(error); await markUnknown(); return false; }
}
