// 每週抓 Tesla 官網台灣站點(公開資料)：超充列表、目的地慢充列表、即將開放、各站詳細 → data/tesla.json
// 充電 App 的 Cloudflare 後端會讀這個檔，跟站點庫比對(Tesla 官網擋雲端主機，所以改由 GitHub 代抓)。
import fs from "fs";
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept-Language": "zh-TW,zh;q=0.9" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, asJson) {
  for (let a = 0; a < 3; a++) {
    try { const r = await fetch(url, { headers: UA }); if (r.status === 200) return asJson ? await r.json() : await r.text(); if (r.status === 403) throw new Error("403 Access Denied"); }
    catch (e) { if (/403/.test(e.message)) throw e; }
    await sleep(1500 * (a + 1));
  }
  throw new Error("失敗：" + url);
}
async function list(path, re, min) {
  const t = await get("https://www.tesla.com/zh_TW/findus/list/" + path), seen = {}, out = []; let m;
  while ((m = re.exec(t))) if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
  if (out.length < min) throw new Error(path + " 只抓到 " + out.length + " 站");
  return out;
}
const out = { at: new Date().toISOString(), open: [], dest: [], destOk: false, soon: [], det: {}, errors: [] };
out.open = await list("superchargers/Taiwan", /findus\/location\/supercharger\/([A-Za-z0-9_\-]+)/g, 30);
try { out.dest = await list("chargers/Taiwan", /findus\/location\/charger\/([A-Za-z0-9_\-]+)/g, 30); out.destOk = true; } catch (e) { out.errors.push("慢充列表：" + e.message); }
try {
  const arr = (((await get("https://www.tesla.com/api/findus/get-locations?country=TW", true)).data) || {}).data || [];
  const seen = {}; out.open.forEach((x) => (seen[x] = 1));
  for (const x of arr) {
    const la = Number(x.latitude), lo = Number(x.longitude), t = x.location_type || [], sl = x.location_url_slug;
    if (!sl || x.inCN || seen[sl] || !(la > 21.8 && la < 26.5 && lo > 118.0 && lo < 122.3)) continue;
    const ft = t.includes("coming_soon_supercharger") ? "coming_soon_supercharger" : t.includes("current_winner_supercharger") ? "current_winner_supercharger" : t.includes("winner_supercharger") ? "winner_supercharger" : "";
    if (!ft) continue; seen[sl] = 1;
    let sf = {}; try { sf = ((await get("https://www.tesla.com/api/findus/get-location-details?locationSlug=" + encodeURIComponent(sl) + "&functionTypes=" + ft + "&locale=zh_TW&isInHkMoTw=false", true)).data || {}).supercharger_function || {}; } catch (e) {}
    out.soon.push({ slug: sl, ft, lat: la, lng: lo, title: String(x.title || "").replace(/^,\s*/, ""), sf: { coming_soon_name: sf.coming_soon_name, customer_facing_coming_soon_date: sf.customer_facing_coming_soon_date, vote_winner_quarter: sf.vote_winner_quarter } });
    await sleep(300);
  }
} catch (e) { out.errors.push("即將開放：" + e.message); }
const q = out.open.map((s) => ["sc", s]).concat(out.destOk ? out.dest.map((s) => ["dc", s]) : []);
for (let i = 0; i < q.length; i += 5) {
  await Promise.all(q.slice(i, i + 5).map(async ([k, s]) => {
    try { const j = await get("https://www.tesla.com/api/findus/get-charger-details?locationSlug=" + encodeURIComponent(s) + "&programType=" + (k === "dc" ? "destination_charger" : "supercharger") + "&locale=zh-TW&isInHkMoTw=false", true);
      out.det[k + ":" + s] = (j && j.data && j.data.data) || null; }
    catch (e) { out.det[k + ":" + s] = { __err: e.message }; }
  }));
  await sleep(400);
}
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/tesla.json", JSON.stringify(out));
console.log("超充", out.open.length, "慢充", out.dest.length, "即將開放", out.soon.length, "詳細", Object.keys(out.det).length, "錯誤", out.errors);
