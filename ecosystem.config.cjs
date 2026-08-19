/* =========================================================================
   רדאר קייט — שירות pm2
   -------------------------------------------------------------------------
   למה זה קיים: שרת הפיתוח לא אמור לרוץ בתוך סשן של קלוד. סשן שמחזיק
   תהליך חי נראה כאילו הוא עדיין עובד, ותהליך שנשאר יתום אחרי סגירת
   סשן תופס את הפורט וגורם ל-EADDRINUSE בסשן הבא. pm2 מנתק את החיים
   של השרת מהחיים של השיחה.

   פורטים אצל ארז:  3000 erez-dashboard · 3100 erez-control-center ·
                    3200 dira-radar · 3300 כאן.

   ⚠️ הסיומת היא .cjs ולא .js במכוון: package.json מכריז "type": "module",
      ולכן קובץ .js נטען כ-ESM ו-module.exports לא קיים בו. pm2 נכשל
      עם "File ecosystem.config.js malformated".

   הפעלה:   pm2 start ecosystem.config.cjs && pm2 save
   מצב:     pm2 list | Select-String kite
   לוגים:   pm2 logs kite-radar-dev --lines 50
   כיבוי:   pm2 stop kite-radar-dev

   ⚠️ pm2 שומר את הסביבה במטמון. אחרי שינוי env צריך
      pm2 delete kite-radar-dev ואז pm2 start — restart לבדו לא יקלוט.
   ⚠️ pm2 save חובה אחרי כל שינוי, אחרת resurrect לא ידע עליו.
   ========================================================================= */

module.exports = {
  apps: [
    {
      name: 'kite-radar-dev',
      script: 'dev-server.js',
      cwd: __dirname,
      env: { PORT: 3300, NODE_ENV: 'development' },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      time: true,
    },
  ],
};
