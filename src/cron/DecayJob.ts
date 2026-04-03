import { Env } from "../index";

export async function processDecayCron(env: Env) {
   // Tell Storage service to decay D1 markers and return purged IDs
   const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/cron/decay', {
        method: 'POST'
   }));
   
   if (storageResp.ok) {
       const data: any = await storageResp.json();
       const purgedIds: string[] = data.purged_ids || [];
       
       // Prune from Vectorize to keep Index and D1 exactly matched
       if (purgedIds.length > 0) {
           await env.SEMANTIC_INDEX.deleteByIds(purgedIds);
           console.log(`[DecayJob] Successfully decayed and purged ${purgedIds.length} markers from Vectorize and D1.`);
       } else {
           console.log(`[DecayJob] Decay loop ran. No markers dropped below existence threshold.`);
       }
   } else {
       console.error(`[DecayJob] Storage service failed to run decay query.`, await storageResp.text());
   }
}
