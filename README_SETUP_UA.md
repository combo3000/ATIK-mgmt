# ATIK online starter

## Що всередині
- `index.html` — ваш оновлений застосунок
- `firebase-config.js` — сюди вставляється Firebase config
- `firebase-config.example.js` — зразок

## Як запустити на GitHub Pages
1. Створіть новий public repo на GitHub, наприклад `atik-online`.
2. Завантажте в репозиторій 3 файли: `index.html`, `firebase-config.js`, `README_SETUP_UA.md`.
3. У GitHub: **Settings → Pages**.
4. В Source оберіть **Deploy from a branch**.
5. Branch: **main**, folder: **/root**.
6. Після цього сайт буде доступний за адресою на кшталт `https://ВАШ-username.github.io/atik-online/`.

## Як підключити Firebase
1. У Firebase створіть project.
2. Додайте **Web app**.
3. Скопіюйте config.
4. Вставте його у `firebase-config.js`.
5. У Firebase увімкніть:
   - **Authentication → Google**
   - **Firestore Database**

## Мінімальні Firestore rules для старту
На перший запуск можна тимчасово поставити таке правило:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /shared/{document} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Що змінилось
- Дані все ще зберігаються локально як резерв.
- Якщо користувач увійшов через Google, стан також пишеться в Firestore.
- Другий користувач бачить зміни майже в реальному часі.

## Важливо
Зараз це **один спільний файл-стан** для двох людей. Це найпростіший і правильний старт. Коли захочете, можна буде рознести дані по колекціях: `buyers`, `products`, `journal`, `stock` — але на старті це не потрібно.

## AI-асистент (сервер на Vercel)
Серверні функції лежать у папці `api/` і працюють тільки на Vercel (на GitHub Pages їх немає, тому додаток звертається до `https://atik-mgmt.vercel.app`).
Функції: `health` (перевірка налаштувань), `parse-sales-report` (AI читає звіт точки), `weekly-report` (AI пише висновки й список дій до тижневого звіту; усі цифри рахує сам додаток), `partner-message` (AI переписує повідомлення точці або покупцю сайту у вашому стилі; надсилаєте ви самі). `assistant` — чат «💬 Асистент» (кнопка в правому нижньому куті): відповідає на питання про продажі, залишки, точки, борги й документи і пропонує кнопки для чернеток (накладна, повідомлення, акт звірки, посилання, звіт). Сам нічого не зберігає, не видаляє й не надсилає; дані рахує додаток у браузері, сервер лише передає питання до Claude.

Змінні середовища у Vercel → Project `atik-mgmt` → Settings → Environment Variables:
- `ANTHROPIC_API_KEY` — ключ Claude API з https://console.anthropic.com (Settings → API Keys).
- `ALLOWED_EMAILS` — через кому Google-адреси, яким дозволено користуватися AI (наприклад `you@gmail.com,wife@gmail.com`). Без цієї змінної AI вимкнено.
- `CLAUDE_MODEL` — необов'язково, за замовчуванням `claude-sonnet-5-5` (Sonnet: дешевше й швидше; для складних фото звітів можна поставити `claude-opus-5-5`).

Після зміни змінних потрібен Redeploy. Перевірка: Налаштування → AI-асистент → «Перевірити підключення».
Тести сервера: `npm install && npm test`.

## Telegram-бот (той самий асистент) і звіт щопонеділка
`api/telegram.js` — бот: відповідає лише Telegram ID зі списку, працює як «💬 Асистент» у додатку (ті самі інструменти й розрахунки: сервер запускає код `index.html` над копією спільних даних лише для читання). Чернетки приходять кнопками, що відкривають додаток із заповненою формою (`?do=doc|msg|act|olink|report`); зберігаєте ви там. Бот пам'ятає розмову 3 години (колекція `tg_sessions`), `/new` починає спочатку.
`api/telegram-weekly.js` — звіт тижня в Telegram щопонеділка о 06:00 UTC (8:00 за Києвом взимку, 9:00 влітку), розклад у `vercel.json`.

Змінні у Vercel:
- `TELEGRAM_BOT_TOKEN` — токен від @BotFather (`/newbot`).
- `TELEGRAM_WEBHOOK_SECRET` — довільний рядок з латинських літер і цифр.
- `FIREBASE_SERVICE_ACCOUNT` — увесь вміст JSON-файла з Firebase → Project settings → Service accounts → Generate new private key.
- `TELEGRAM_ALLOWED_IDS` — Telegram ID через кому (бот підкаже ваш ID, якщо написати йому до того, як ви в списку).
- `CRON_SECRET` — довільний рядок; ним Vercel запускає щотижневий звіт.
- `TELEGRAM_REPORT_CHAT_IDS` — необов'язково, кому слати звіт (за замовчуванням усім з `TELEGRAM_ALLOWED_IDS`).
- `APP_URL` — необов'язково, адреса додатка для кнопок (за замовчуванням `https://combo3000.github.io/ATIK-mgmt/`).

Увімкнення: після Redeploy відкрийте `https://atik-mgmt.vercel.app/api/telegram?setup=<TELEGRAM_WEBHOOK_SECRET>`. Перевірити звіт вручну: `https://atik-mgmt.vercel.app/api/telegram-weekly?key=<CRON_SECRET>`.
