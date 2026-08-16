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

## שלב 2 — להעלות את האתר (בחר אפשרות אחת)

### אפשרות א׳ — Cloudflare Pages (מומלץ)

הכי מהיר בעולם, CDN גלובלי, בלי הגבלת תעבורה.

1. להעלות את התיקייה `ai-text-watermark-remover/` ל‑GitHub (כבר עשינו — היא בריפו).
2. ב‑Cloudflare Dashboard: `Workers & Pages` → `Create` → `Pages` → `Connect to Git`.
3. לבחור את הריפו `buki5/or-hashma`.
4. הגדרות build — **חשוב**:
   - **Framework preset:** `None`
   - **Build command:** להשאיר **ריק**
   - **Build output directory:** `ai-text-watermark-remover`
   - **Production branch:** `claude/ai-text-watermark-remover-bcw4ur` (או `master` אחרי מיזוג)
5. `Save and Deploy`. אחרי ~30 שניות תקבל כתובת חיה `xxx.pages.dev`.
6. לחיבור הדומיין: `Custom domains` → `Set up a domain` → להקליד את הדומיין → Cloudflare מוסיף את ה‑DNS לבד.

### אפשרות ב׳ — Netlify

1. <https://app.netlify.com> → `Add new site` → `Import an existing project` → GitHub.
2. לבחור את הריפו. הגדרות:
   - **Base directory:** `ai-text-watermark-remover`
   - **Build command:** ריק
   - **Publish directory:** `ai-text-watermark-remover`
3. `Deploy site` → מקבלים כתובת `xxx.netlify.app`.
4. `Domain settings` → `Add custom domain` → לעדכן ב‑Registrar את רשומות ה‑DNS שנטליפיי מציגה.

**בונוס:** אפשר פשוט לגרור את התיקייה ל‑<https://app.netlify.com/drop> ולקבל אתר חי בלי Git בכלל.

### אפשרות ג׳ — GitHub Pages

חינמי, אבל דורש שהאתר יהיה בשורש הריפו או בתיקיית `docs/`.
מכיוון שבריפו הזה כבר יושב אתר אחר (`or-hashma`) בשורש, עדיף לפתוח **ריפו נפרד**:

1. לפתוח ריפו חדש בשם `ai-text-watermark-remover`.
2. להעתיק לתוכו את **תוכן** התיקייה (כך ש‑`index.html` יהיה בשורש).
3. `Settings` → `Pages` → `Source: Deploy from a branch` → `main` / `root` → `Save`.
4. הכתובת תהיה `https://USERNAME.github.io/ai-text-watermark-remover/`.
5. לדומיין מותאם: `Settings` → `Pages` → `Custom domain`, ולהוסיף ב‑DNS רשומת `CNAME` ל‑`USERNAME.github.io`.

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

## שלב 5 — הפעלת ה-API של הזיהוי (כשהוא ייצא)

האתר **כבר בנוי ומחווט** לעבוד מול API אמיתי של זיהוי סימני מים. אין קוד חסר. מה שצריך ביום שהוא יוצא:

1. **להעלות את הפרוקסי** — הקובץ `functions/api/detect.js` כבר במקום הנכון. Cloudflare Pages מזהה אותו
   אוטומטית ומגיש אותו ב-`/api/detect`. (ל-Netlify יש גרסה מקבילה ב-`netlify/functions/detect.js`.)
2. **להגדיר משתני סביבה** ב-Cloudflare (`Settings` → `Environment variables`):
   - `WATERMARK_API_KEY` — המפתח הסודי. **לא מגיע לדפדפן אף פעם.**
   - `WATERMARK_API_URL` — כתובת ה-API של הספק.
3. **לבדוק** שהנקודה עונה:
   ```bash
   curl -X POST https://YOUR-DOMAIN/api/detect \
     -H 'Content-Type: application/json' -d '{"texts":["hello world"]}'
   ```
4. **להדליק את המתג** ב-`assets/js/config.js`:
   ```js
   features: { officialDetector: true }
   ```
5. לרענן — כל הקופי באתר מתחלף אוטומטית לגרסה שמדברת על אימות מול הגלאי הרשמי, ובורר המנוע נפתח.

⚠️ **אל תדליק את המתג לפני שה-API באמת עובד.** הקופי ה"חי" אומר למבקרים שהטקסט שלהם נבדק מול הגלאי
הרשמי. אם זה לא קורה בפועל — האתר משקר למי שמסתמך עליו.

**עלות:** הפרוקסי רץ על השכבה החינמית (Cloudflare Pages Functions: 100K קריאות ביום). התשלום היחיד
הוא לספק ה-API לפי שימוש. ריצה טיפוסית על מסמך של 3 פסקאות = **4 בקשות** בלבד, בזכות batching ו-cache.
התקרות ב-`config.js` (`maxCallsPerRun: 40`) מונעות הפתעות.

פירוט מלא של החוזה, מבנה הבקשה/תשובה ומיפוי שדות: **[API.md](API.md)**.

---

## שאלות נפוצות בהעלאה

**האם צריך שרת או Node?** לא. זה HTML/CSS/JS סטטי בלבד.

**האם ה‑API יעבוד מהדפדפן?** כן. Datamuse תומך ב‑CORS ולא דורש מפתח. אם הוא לא זמין — האתר עובר אוטומטית
למילון הפנימי ומודיע על כך למשתמש.

**מה עם HTTPS?** מגיע בחינם ואוטומטית בכל שלוש האפשרויות.

**האם התוכן של המשתמשים נשמר אצלי?** לא. הכל רץ בדפדפן של המשתמש; לשרת לא נשלח שום טקסט.
