# מדריך העלאה לאוויר — AI Text Watermark Remover

האתר הוא אתר **סטטי** לגמרי (HTML + CSS + JS, בלי שרת ובלי בסיס נתונים).
המשמעות: האחסון עצמו **חינמי לחלוטין**, וההוצאה היחידה שלך היא הדומיין.

---

## סיכום עלויות

| מה | עלות |
| --- | --- |
| אחסון (Cloudflare Pages / Netlify / GitHub Pages) | **0 ₪** — לתמיד, כולל SSL ו‑CDN |
| תעבורה (bandwidth) | **0 ₪** — ללא הגבלה מעשית |
| API של מילים נרדפות (Datamuse) | **0 ₪** — בלי מפתח ובלי הרשמה |
| שכבת שרת לסודות (Cloudflare Functions) | **0 ₪** — 100K קריאות ביום |
| אימות אנושי (Turnstile) | **0 ₪** — ללא הגבלה |
| דומיין `.com` | כ‑**$10–12 לשנה** (ההוצאה היחידה) |
| דומיין זול יותר (`.site`, `.online`, `.xyz`) | כ‑**$1–3 לשנה הראשונה** |

> אפשר גם בלי דומיין בכלל: תקבל כתובת חינמית כמו `ai-text-watermark-remover.pages.dev`.

---

## שלב 1 — לקנות דומיין (ההוצאה היחידה)

מומלץ: **Cloudflare Registrar** — מוכר במחיר עלות, בלי התחדשות מנופחת בשנה השנייה, ו‑WHOIS privacy בחינם.
חלופות: Namecheap, Porkbun.

1. להיכנס ל‑<https://dash.cloudflare.com> ולפתוח חשבון.
2. `Domain Registration` → `Register Domain` → לחפש את השם.
3. שמות אפשריים אם ה‑`.com` תפוס:
   `aitextwatermarkremover.com` · `watermarkremover.ai` · `removeaiwatermark.com` · `aiwatermarkremover.io`
4. לשלם ולסיים. אם קנית ב‑Cloudflare — ה‑DNS כבר מחובר אוטומטית ואין מה להגדיר.

---

## איזו תשתית לבחור — התשובה הקצרה

**Cloudflare Pages.** לא בגלל שהיא הכי מוכרת, אלא בגלל שהיא היחידה שנותנת לך את **שני** הדברים שאתה
צריך על אותו דומיין ובחינם:

1. **אחסון סטטי** — ה-HTML/CSS/JS, על CDN גלובלי, בלי הגבלת תעבורה.
2. **שכבת שרת** (Pages Functions) — הקוד שמחזיק את מפתחות ה-API הסודיים.

בכל פתרון אחר תצטרך *שני* שירותים נפרדים (אחסון + שרת), ואז נופלת עליך בעיית CORS ודומיין שני.
כאן `/api/detect` יושב על אותו דומיין כמו האתר. אפס הגדרות רשת.

| | Cloudflare Pages | Netlify | GitHub Pages | Vercel |
| --- | --- | --- | --- | --- |
| אחסון סטטי חינם | ✅ | ✅ | ✅ | ✅ |
| פונקציות שרת חינם | ✅ 100K/יום | ✅ 125K/חודש | ❌ **אין** | ✅ |
| תעבורה | ללא הגבלה | 100GB/חודש | ~100GB רך | 100GB/חודש |
| דומיין מותאם + SSL | ✅ חינם | ✅ חינם | ✅ חינם | ✅ חינם |
| Turnstile (אימות אנושי) | ✅ מובנה | דרך CF | דרך CF | דרך CF |

**GitHub Pages פסול לפרויקט הזה** — אין בו שום צד שרת, כלומר אין איפה להחביא את מפתח ה-API.

### על "אחסון שגוגל מאנדקס מהר"

אין חבילת אחסון שגורמת לגוגל לאנדקס מהר יותר. זו אמונה רווחת אבל היא לא נכונה, ואני מעדיף להגיד לך
את זה מאשר למכור לך משהו. מה שבאמת קובע את מהירות האינדוקס:

1. **Search Console** — הגשת sitemap + `Request Indexing` ידני. זה הזרז האמיתי (בדרך כלל שעות עד ימים).
2. **תוכן ייחודי ובעל ערך** — הכלי עצמו עובד בדפדפן, וזה בדיוק מה שגוגל מחפש בקטגוריה הזאת.
3. **מהירות טעינה ויציבות** — כאן התשתית כן משפיעה, ו-Cloudflare מצוינת (TTFB נמוך, זמינות גבוהה).
4. **קישורים נכנסים** — הגורם החזק ביותר לטווח ארוך.

האתר כבר מוכן לכל 3 הראשונים.

---

## שלב 2 — להעלות את האתר

### Cloudflare Pages (המומלץ)

1. ב-Cloudflare Dashboard: `Workers & Pages` → `Create` → `Pages` → `Connect to Git`.
2. לבחור את הריפו `buki5/or-hashma`.
3. הגדרות build — **חשוב**:
   - **Framework preset:** `None`
   - **Build command:** להשאיר **ריק**
   - **Build output directory:** `ai-text-watermark-remover`
   - **Production branch:** `claude/ai-text-watermark-remover-bcw4ur` (או `master` אחרי מיזוג)
4. `Save and Deploy`. אחרי ~30 שניות יש כתובת חיה `xxx.pages.dev`.
5. **דומיין:** `Custom domains` → `Set up a domain` → להקליד את הדומיין. אם קנית אותו ב-Cloudflare,
   ה-DNS מוגדר אוטומטית ואין מה לעשות. אם הוא במקום אחר — Cloudflare מציגה בדיוק אילו רשומות להוסיף.

התיקייה `functions/` נסרקת אוטומטית. `functions/api/detect.js` הופך ל-`/api/detect`,
ו-`functions/api/verify.js` ל-`/api/verify`. אין מה להגדיר.

### Netlify (חלופה)

זהה בעיקרון. `Base directory` ו-`Publish directory` = `ai-text-watermark-remover`, build command ריק.
צריך גם `netlify.toml` שיפנה את הכתובות לפונקציות:

```toml
[[redirects]]
  from = "/api/detect"
  to   = "/.netlify/functions/detect"
  status = 200

[[redirects]]
  from = "/api/verify"
  to   = "/.netlify/functions/verify"
  status = 200
```

---

## שלב 3 — להחליף את הדומיין הזמני בקוד (חובה!)

בקוד מופיע דומיין זמני `www.aitextwatermarkremover.com` ב‑canonical, ב‑sitemap, ב‑robots וב‑Open Graph.
**חייבים** להחליף אותו לדומיין האמיתי, אחרת גוגל יתבלבל ולא יאנדקס נכון:

```bash
cd ai-text-watermark-remover
grep -rl "aitextwatermarkremover.com" . | xargs sed -i "s/www\.aitextwatermarkremover\.com/YOUR-DOMAIN.com/g"
```

לעדכן גם את התאריכים ב‑`sitemap.xml` אם עבר זמן.

---

## שלב 4 — SEO אחרי העלייה

1. **Google Search Console** — <https://search.google.com/search-console>
   - להוסיף את הדומיין, לאמת בעלות (הכי קל: רשומת TXT ב‑DNS).
   - `Sitemaps` → להזין `sitemap.xml` → `Submit`.
   - `URL Inspection` → להדביק את כתובת הבית → `Request Indexing`.
2. **Bing Webmaster Tools** — <https://www.bing.com/webmasters> (אפשר לייבא ישירות מגוגל בלחיצה).
3. לבדוק את הנתונים המובנים: <https://search.google.com/test/rich-results> — אמורים לזהות `FAQPage`, `HowTo`
   ו‑`SoftwareApplication`.
4. לבדוק מהירות ונגישות: <https://pagespeed.web.dev> — האתר אמור לקבל ציונים גבוהים מאוד (אין תלויות חיצוניות,
   אין פונטים חיצוניים, אין תמונות כבדות).

### מה כבר מוכן באתר מבחינת SEO

- `title` ו‑`meta description` ממוקדי מילות מפתח
- קישור `canonical` בכל עמוד
- Open Graph + Twitter Card עם תמונת שיתוף 1200×630
- נתונים מובנים (JSON-LD): `WebSite`, `SoftwareApplication`, `FAQPage`, `HowTo`
- `robots.txt` + `sitemap.xml`
- HTML סמנטי, כותרת `h1` אחת, היררכיית כותרות תקינה
- מותאם מובייל, תמיכה במצב כהה/בהיר, `prefers-reduced-motion`
- עמוד שגיאה 404, עמודי פרטיות ותנאי שימוש (גוגל אוהב אתרים עם עמודים כאלה)
- אפס תלויות חיצוניות → טעינה מהירה מאוד

---

---

## שלב 5 — שכבת השרת: איפה המפתחות הסודיים חיים

זה החלק שביקשת שאסביר. **הדפדפן לעולם לא רואה את המפתח שלך.**

```
   הדפדפן של המשתמש                שכבת הקצה שלך              ספק ה-API
   (הקוד שכולם רואים)              (Cloudflare Functions)      (הזיהוי)
   ─────────────────               ──────────────────────      ──────────
   POST /api/detect        ──►     קורא WATERMARK_API_KEY
   { texts: [...] }                ממשתני הסביבה         ──►   בקשה עם המפתח
                                   ◄── ציונים                  ◄── תשובה
   ◄── { results: [...] }
```

**למה זה חייב לעבוד ככה:** כל דבר שנמצא בקוד של הדפדפן — קובץ JS, משתנה, שדה קלט — גלוי לכל מי
שלוחץ F12. אין דרך "להסתיר" מפתח בצד לקוח. לכן הורדתי את שדה הזנת המפתח שהיה בגרסה הקודמת:
הוא היה נוח לבדיקות אבל לא היה מקום שאפשר להשתמש בו באמת.

**מה שכן קיים:** שני קבצים בתיקייה `functions/api/` שרצים על שרתי הקצה של Cloudflare, לא אצל המשתמש:

| קובץ | כתובת | תפקיד |
| --- | --- | --- |
| `detect.js` | `/api/detect` | מקבל טקסטים, מוסיף את המפתח הסודי, קורא לספק, מחזיר ציונים בלבד |
| `verify.js` | `/api/verify` | מאמת את אתגר ה-Turnstile ומנפיק session חתום |

**משתני סביבה** (Cloudflare: `Settings` → `Environment variables` → `Encrypt` על הסודיים):

| משתנה | חובה? | תפקיד |
| --- | --- | --- |
| `WATERMARK_API_KEY` | ✅ | המפתח שלך לספק הזיהוי |
| `WATERMARK_API_URL` | ✅ | כתובת ה-API של הספק |
| `TURNSTILE_SECRET_KEY` | לאימות | החצי הסודי של Turnstile |
| `SESSION_SECRET` | לאימות | מחרוזת אקראית ארוכה משלך (לחתימת ה-session) |
| `ALLOWED_ORIGIN` | מומלץ | הדומיין שלך — חוסם שימוש מאתרים אחרים |

**עלות:** 100,000 קריאות ליום בחינם. ריצה על מסמך של 3 פסקאות = 4 קריאות. אתה לא תתקרב לתקרה.

---

## שלב 6 — הדלקת האימות האנושי (Turnstile)

מונע מבוטים לשרוף לך את תקציב ה-API. חינמי, ורוב הזמן בכלל בלתי נראה למשתמש.

1. ב-Cloudflare Dashboard → `Turnstile` → `Add widget`. לבחור את הדומיין ומצב `Managed`.
2. מקבלים שני מפתחות:
   - **Site key** (ציבורי) → ל-`assets/js/config.js`:
     ```js
     turnstile: { enabled: true, siteKey: '0x4AAA...' }
     ```
   - **Secret key** → למשתנה הסביבה `TURNSTILE_SECRET_KEY`. **לא** לקוד.
3. להגדיר `SESSION_SECRET` לכל מחרוזת אקראית ארוכה (`openssl rand -base64 32`).

**איך זה מתנהג:** האימות מופיע רק כשהמשתמש מפעיל ריצה שעולה כסף (כלומר מול ה-API), אחרי הלחיצה —
לא בכניסה לאתר. בדיקה אחת מכסה את כל הריצה (30 דקות), כי הטוקן של Turnstile הוא חד-פעמי אבל
ריצה אחת עושה כמה קריאות. ריצות מקומיות (המנוע המובנה) לא נחסמות בכלל — הן לא עולות כלום.
לשנות ל-`protect: 'all'` אם רוצים אימות גם עליהן.

**חשוב:** כל עוד `TURNSTILE_SECRET_KEY` לא מוגדר בשרת, הפונקציות עובדות רגיל בלי אימות. ברגע
שהוא מוגדר — בקשה בלי session תקין נדחית ב-401. אין מצב ביניים שבו האימות "נראה" עובד אבל לא באמת.

---

## שלב 7 — הפעלת ה-API של הזיהוי (כשהוא ייצא)

האתר **כבר בנוי ומחווט**. אין קוד חסר. ביום שה-API יוצא:

1. להגדיר `WATERMARK_API_KEY` ו-`WATERMARK_API_URL` במשתני הסביבה.
2. לבדוק שהנקודה עונה:
   ```bash
   curl -X POST https://YOUR-DOMAIN/api/detect \
     -H 'Content-Type: application/json' -d '{"texts":["hello world"]}'
   ```
3. אם מבנה התשובה של הספק שונה — לתקן **רק** את הפונקציה `normalise()` בקובץ הפונקציה
   ואת `normalizeResult()` ב-`detector.js`. שום מקום אחר בקוד לא קורא את התשובה הגולמית.
4. להדליק את המתג ב-`assets/js/config.js`:
   ```js
   features: { officialDetector: true }
   ```
5. לרענן — בורר המנוע נפתח, וכל הקופי מתחלף אוטומטית לגרסה שמדברת על אימות מול הגלאי הרשמי.

⚠️ **אל תדליק את המתג לפני שה-endpoint באמת עונה.** הקופי החי אומר למבקרים שהטקסט שלהם נבדק מול
הגלאי הרשמי. אם זה לא קורה — האתר משקר למי שמסתמך עליו כדי להגיש עבודה.

פירוט מלא של החוזה ומיפוי השדות: **[API.md](API.md)**.

---

## שאלות נפוצות בהעלאה

**האם צריך שרת או Node?** לא. זה HTML/CSS/JS סטטי בלבד.

**האם ה‑API יעבוד מהדפדפן?** כן. Datamuse תומך ב‑CORS ולא דורש מפתח. אם הוא לא זמין — האתר עובר אוטומטית
למילון הפנימי ומודיע על כך למשתמש.

**מה עם HTTPS?** מגיע בחינם ואוטומטית בכל שלוש האפשרויות.

**האם התוכן של המשתמשים נשמר אצלי?** לא. הכל רץ בדפדפן של המשתמש; לשרת לא נשלח שום טקסט.
