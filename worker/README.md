# Worker ההתראות — מה להריץ, לפי הסדר

זה ה-Worker היחיד בפרויקט והמקום היחיד שמחזיק סוד. הוא נפרס **ידנית**, בנפרד מהאתר.
האתר נפרס ב-`git push` ואין לו פקודת פריסה; שינוי כאן לא מגיע לענן עד ש-`wrangler deploy` רץ.

**באתר אין ממשק הרשמה בכלל.** ההרשמה קורית כולה בתוך טלגרם, דרך קישור עומק. זה בכוונה.

---

## לפני שמתחילים

* לפתוח **חלון PowerShell אחד** ולהשאיר אותו פתוח עד הסוף. המשתנים (`$w`, `$secret`, `$token`) חיים בחלון, ונסגרים איתו.
* ב-PowerShell 5.1 **אין `&&`**. כל פקודה בשורה נפרדת. אם משהו נכשל — לעצור, לא להמשיך לשורה הבאה.
* כל הפקודות רצות מתוך תיקיית `worker` שבשורש הריפו. `$REPO` בפקודות = הנתיב
  שבו שכפלת את הריפו; להגדיר פעם אחת בחלון לפני שמתחילים.

| מה | פעולה |
|---|---|
| שורה בתוך גוש `powershell` | **להקליד/להדביק בחלון PowerShell ואז Enter** |
| שלב 1, שלב 8 | **הקלקות בטלגרם**, לא פקודות |
| שלב 3 | wrangler פותח דפדפן — **להקליק "Allow"** |

---

## שלב 0 — להתקין wrangler (פעם אחת בלבד)

```powershell
npm install -g wrangler
```

```powershell
$w = "$env:APPDATA\npm\wrangler.cmd"
& $w --version
```

אם השורה השנייה מחזירה מספר גרסה — מוכן. אם היא מחזירה שגיאה, ההתקנה לא הצליחה.

```powershell
Set-Location "$REPO\worker"
```

---

## שלב 1 — ליצור בוט (הקלקות בטלגרם, לא פקודות)

1. לפתוח טלגרם, לחפש למעלה `@BotFather`, לפתוח את הצ'אט ולהקיש **Start**.
2. להקליד `/newbot` ו-Enter.
3. הוא שואל שם תצוגה — להקליד למשל `רדאר קייט`.
4. הוא שואל שם משתמש, חייב להסתיים ב-`bot` — להקליד למשל `KiteRadarILbot`.
5. הוא מחזיר הודעה עם שורה שנראית כך:
   `123456789:AAH...` — **זה הטוקן.**

**לא להדביק את הטוקן לשום קובץ בפרויקט.** להשאיר את הצ'אט פתוח, נחזור אליו בשלב 6.
לרשום לעצמך גם את שם המשתמש של הבוט (`KiteRadarILbot`) — הוא נדרש בשלב 9.

---

## שלב 2 — לייצר את סוד ה-webhook

הסוד הזה אינו הטוקן. הוא מה שמונע ממי שגילה את כתובת ה-Worker להזריק עדכונים מזויפים.

```powershell
$secret = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
$secret
```

השורה השנייה מדפיסה אותו. הוא חי במשתנה `$secret` עד סוף השלב 7 — **אין צורך להעתיק אותו לשום מקום.**

---

## שלב 3 — להתחבר ל-Cloudflare

```powershell
& $w login
```

נפתח דפדפן עם דף הרשאה של Cloudflare → **להקליק "Allow"**. לחזור לחלון PowerShell.

---

## שלב 4 — ליצור את מרחב ה-KV ולהדביק את ה-id

```powershell
& $w kv namespace create KITE_SUBS
```

> אם הפקודה מחזירה `Unknown argument`, הגרסה ישנה — לנסות `& $w kv:namespace create KITE_SUBS` (עם נקודתיים).

הפלט נגמר בגוש כזה:

```
[[kv_namespaces]]
binding = "KITE_SUBS"
id = "3f9c2b1a4e5d6f708192a3b4c5d6e7f8"
```

לפתוח את `worker\wrangler.toml` שבשורש הריפו,
למצוא את השורה שכתוב בה `REPLACE_WITH_ID_FROM_WRANGLER_KV_NAMESPACE_CREATE`,
ולהחליף **רק את מה שבין המרכאות** ב-id שהפקודה הדפיסה. לשמור.

---

## שלב 5 — פריסה ראשונה

```powershell
& $w deploy
```

הפלט מסתיים בכתובת מהצורה `https://kite-alerts.<something>.workers.dev`.
**להעתיק אותה** ולשמור אותה במשתנה (להחליף את הכתובת לזו שהתקבלה בפועל):

```powershell
$workerUrl = "https://kite-alerts.<something>.workers.dev"
curl.exe -s "$workerUrl/health"
```

התשובה צריכה להיות `ok`. אם לא — הפריסה לא עלתה, אין טעם להמשיך.

> הפריסה הראשונה רצה בלי סודות. זה תקין: שום דבר עדיין לא פונה ל-Worker.

---

## שלב 6 — להזין את הסודות

```powershell
& $w secret put TG_BOT_TOKEN
```

הפקודה עוצרת ומבקשת את הערך. **להדביק את הטוקן משלב 1 ו-Enter.** הוא לא מוצג על המסך — זה תקין.

```powershell
$secret | & $w secret put TG_WEBHOOK_SECRET
```

השורה הזו מזינה את הסוד משלב 2 ישירות, בלי להדביק ובלי להציג אותו.

לוודא ששניהם קיימים:

```powershell
& $w secret list
```

צריכות להופיע שתי שורות: `TG_BOT_TOKEN` ו-`TG_WEBHOOK_SECRET`. **הערכים לעולם לא מוצגים** — זה תקין.

---

## שלב 7 — לרשום את ה-webhook מול טלגרם

⚠️ **חובה `curl.exe` ולא `Invoke-RestMethod`.** ב-PowerShell 5.1 `Invoke-RestMethod` מפענח תשובה
בלי `charset` כ-ISO-8859-1 ומשחית UTF-8. `curl.exe` הוא ה-curl האמיתי של Windows ולא כינוי.
(ה-`.exe` בסוף אינו קישוט — בלעדיו PowerShell מפנה את `curl` ל-`Invoke-WebRequest`.)

להדביק את הטוקן משלב 1 במקום `<TOKEN>`:

```powershell
$token = "<TOKEN>"
curl.exe -s -X POST "https://api.telegram.org/bot$token/setWebhook" -d "url=$workerUrl/tg" -d "secret_token=$secret"
```

התשובה צריכה להכיל `"ok":true`.

> הפרמטרים מועברים כשדות טופס ולא כ-JSON **במכוון**: PowerShell 5.1 בולעת מרכאות כפולות
> כשהיא מעבירה מחרוזת לתוכנית חיצונית, וגוש JSON בשורת פקודה נשבר שם בשקט.

לאמת:

```powershell
curl.exe -s "https://api.telegram.org/bot$token/getWebhookInfo"
```

לוודא בפלט:
* `"url":"https://kite-alerts.....workers.dev/tg"` — הכתובת הנכונה
* `"has_custom_certificate":false`
* `"pending_update_count":0`
* `"last_error_message"` — **לא אמור להופיע.** אם הוא מופיע, הוא אומר בדיוק מה נשבר.

---

## שלב 8 — תפריט הפקודות בבוט (הקלקות בטלגרם)

בצ'אט של `@BotFather`:

1. להקליד `/setcommands` ו-Enter.
2. הוא מציג רשימת בוטים — **להקליק על הבוט שלך**.
3. להדביק את הגוש הבא **כהודעה אחת** ו-Enter:

```
spots - לבחור חופים
threshold - סף מהירות בקשרים
quiet - שעות שקט
status - מה מוגדר עכשיו
stop - להפסיק התראות
help - עזרה
```

---

## שלב 9 — בדיקה מקצה לקצה

לפתוח בדפדפן (להחליף לשם המשתמש של הבוט שלך):

```
https://t.me/KiteRadarILbot?start=bat-yam
```

טלגרם נפתחת עם כפתור **START** → להקליק. הבוט אמור לענות "נרשמת להתראות על חוף תאיו — בת ים".
אחר כך להקליד `/spots` בצ'אט — אמורה להופיע רשימת 26 החופים עם ✅/⬜, וכל הקשה הופכת סימון **באותה הודעה**.

**זה הקישור שמחלקים.** התבנית: `https://t.me/<שם-הבוט>?start=<מזהה-הספוט>`.
מזהי הספוטים הם שדה `id` ב-`public/data/spots.json` (`bat-yam`, `zikim`, `betzet`…).

---

## שלב 10 — לבדוק שה-cron עובד בלי לחכות לבוקר

ה-cron רץ רק על גרסה פרוסה, לא בפיתוח מקומי. כדי לירות אותו ידנית:

```powershell
& $w dev --test-scheduled
```

בחלון **שני** של PowerShell:

```powershell
curl.exe -s "http://127.0.0.1:8787/__scheduled"
```

ולראות בחלון הראשון שורת `alerts run {...}`. `Ctrl+C` בחלון הראשון כדי לעצור.

לראות מה קרה בענן בריצות אמיתיות:

```powershell
& $w tail
```

---

## שגרה — אחרי כל שינוי בקוד ה-Worker

```powershell
Set-Location "$REPO"
npm test
```

```powershell
Set-Location "$REPO\worker"
& $w deploy
```

הסודות וה-KV שורדים פריסה. אין צורך לחזור על שלבים 4–8.

---

## פיתוח מקומי (לא חובה)

ליצור `worker\.dev.vars` עם שתי שורות:

```
TG_BOT_TOKEN=123456789:AAH...
TG_WEBHOOK_SECRET=...
```

הקובץ **מכוסה ב-`.gitignore` של הריפו** (`.dev.vars`, בלי לוכסן — git מחיל אותו בכל תיקייה) ולא ייכנס לגיט.
לא ליצור אותו בשולחן העבודה או ב"מסמכים" של Windows — הם מנותבים ל-OneDrive.

---

## חירום — לנתק את הבוט מיד

```powershell
curl.exe -s -X POST "https://api.telegram.org/bot$token/deleteWebhook"
```

מרגע זה טלגרם מפסיקה לשלוח עדכונים ל-Worker. ה-cron עדיין רץ; כדי לעצור גם אותו:

```powershell
& $w delete
```

(מוחק את ה-Worker כולו. ה-KV והמנויים שבו **נשארים**.)

---

## תקלות נפוצות

| מה רואים | מה זה |
|---|---|
| `& $w` מחזיר "not recognized" | שלב 0 לא רץ, או שהחלון נסגר ו-`$w` התאפס. להריץ שוב את `$w = "$env:APPDATA\npm\wrangler.cmd"` |
| הפריסה נכשלת עם "KV namespace not found" | ה-id בשלב 4 לא הודבק ל-`wrangler.toml` |
| הבוט לא עונה בכלל | `getWebhookInfo` → לקרוא את `last_error_message` |
| `getWebhookInfo` מראה 403 | הסוד ב-`setWebhook` שונה מזה שב-`wrangler secret`. לחזור על שלבים 2, 6 ו-7 ברצף באותו חלון |
| הודעות עברית מגיעות עם ג'יבריש | `Invoke-RestMethod` במקום `curl.exe`. לחזור לשלב 7 |
| הבוט עונה אבל התראות לא יוצאות | `& $w tail`, ואז לבדוק ב-`/status` שנבחרו חופים ושהסף לא גבוה מדי |
