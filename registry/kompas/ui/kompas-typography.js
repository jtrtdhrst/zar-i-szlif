export function renderKompasTypography() {
  return `<section style="display:grid;gap:28px;padding:24px;background:var(--paper)">
  <div><p class="eyebrow">Kicker — 12/16 850 ls .105em uppercase + dash 32px</p><h1 style="margin:12px 0 0;font-family:var(--font-display);font-size:clamp(38px,4vw,52px);line-height:1.04;font-weight:900;letter-spacing:-.032em">Nagłówek H1 — Noto Sans Display 900</h1><p style="max-width:560px;margin:16px 0 0;color:var(--muted);font-size:20px;line-height:28px;font-weight:700">Lead — 20/28, waga 700, max 560 px, kolor muted. Służy do wprowadzenia sekcji.</p><p style="max-width:560px;margin:12px 0 0;color:#3f4b3e;font-size:16px;line-height:25px">Copy — 16/25, kolor #3f4b3e, lewe wyrównanie, bez centrowania w sekcjach informacyjnych.</p></div>
  <div style="display:flex;align-items:center;gap:12px;color:var(--red);font-size:10px;font-weight:850;letter-spacing:.13em;text-transform:uppercase"><span style="width:32px;height:2px;background:currentColor"></span> Eyebrow gold na ciemnym tle</div>
  <p style="margin:0;color:var(--muted);font-size:12px">Caption / helper — 12/20, muted.</p>
</section>`;
}
