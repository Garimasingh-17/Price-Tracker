async function test() {
  const urls = [
    'https://demo.inelabteamdev.com/',
    'https://demo.inelabteamdev.com/api/products',
    'https://demo.inelabteamdev.com/products.json',
    'https://demo.inelabteamdev.com/api/catalog',
    'https://demo.inelabteamdev.com/products'
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u);
      const text = await res.text();
      console.log(u, 'status:', res.status, 'ct:', res.headers.get('content-type'), 'len:', text.length, 'isHtmlSpa:', text.includes('id="root"'));
    } catch (e) {
      console.log(u, 'ERR:', e.message);
    }
  }
}
test();
