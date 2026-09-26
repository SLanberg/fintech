# Lockin & Build (Monorepo Architecture)

Приложение разделено на **Backend** (Express.js + TypeScript) и **Frontend** (Next.js 16 + React 19).

## Структура проекта

```
/
├── backend/                # Express.js REST API сервер (порт 5001)
│   ├── src/
│   │   └── server.ts       # Эндпоинты /api/account, /api/transactions
│   ├── package.json
│   └── tsconfig.json
├── frontend/               # Next.js интерфейс приложения (порт 3000)
│   ├── src/
│   │   └── app/            # Страницы и компоненты
│   ├── public/             # Статические ресурсы (аватары, иконки)
│   ├── package.json
│   └── tsconfig.json
├── package.json            # Root workspace конфиг для параллельного запуска
└── README.md
```

## Запуск приложения

### 1. Одновременный запуск Frontend и Backend (Рекомендуется)
В корневой директории выполните:
```bash
npm run dev
```
Это запустит:
- **Backend API:** `http://localhost:5001`
- **Frontend App:** `http://localhost:3000`

### 2. Раздельный запуск

#### Только Backend:
```bash
npm run dev:backend
# или: cd backend && npm run dev
```

#### Только Frontend:
```bash
npm run dev:frontend
# или: cd frontend && npm run dev
```

## API Эндпоинты Backend (`http://localhost:5001/api`)

- `GET /api/account` - получение профиля пользователя, текущего баланса и статистики доходов/расходов.
- `GET /api/transactions` - получение списка транзакций.
- `POST /api/transactions` - проведение пополнения / перевода (динамически обновляет баланс).
- `GET /api/health` - проверка статуса сервера.
