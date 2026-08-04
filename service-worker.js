self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await Promise.all((await caches.keys()).map(key=>caches.delete(key)));
  await self.registration.unregister();
  const clients=await self.clients.matchAll({type:'window'});
  await Promise.all(clients.map(client=>client.navigate(client.url)));
})()));
