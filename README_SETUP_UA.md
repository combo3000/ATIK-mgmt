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
