// Tymczasowy Worker diagnostyczny: sprawdza, czy deploy przez `wrangler --env`
// w ogóle routuje ruch (nie dotyka silników ani sekretów).
export default {
  fetch(request: Request): Response {
    return new Response(`probe-ok ${new URL(request.url).pathname}`, {
      headers: { "content-type": "text/plain" },
    });
  },
};
