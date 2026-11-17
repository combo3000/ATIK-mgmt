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
Функції: `health` (перевірка налаштувань), `parse-sales-report` (AI читає звіт точки), `weekly-report` (AI пише висновки й список дій до тижневого звіту; усі цифри рахує сам додаток).

Змінні середовища у Vercel → Project `atik-mgmt` → Settings → Environment Variables:
- `ANTHROPIC_API_KEY` — ключ Claude API з https://console.anthropic.com (Settings → API Keys).
- `ALLOWED_EMAILS` — через кому Google-адреси, яким дозволено користуватися AI (наприклад `you@gmail.com,wife@gmail.com`). Без цієї змінної AI вимкнено.
- `CLAUDE_MODEL` — необов'язково, за замовчуванням `claude-sonnet-5-5` (Sonnet: дешевше й швидше; для складних фото звітів можна поставити `claude-opus-5-5`).

Після зміни змінних потрібен Redeploy. Перевірка: Налаштування → AI-асистент → «Перевірити підключення».
Тести сервера: `npm install && npm test`.
