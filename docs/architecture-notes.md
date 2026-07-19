# PNB Architecture Notes (Sub-step A.1 snapshot)

Эти заметки фиксируют состояние архитектуры на момент завершения Sub-step A.1
(инициализация backend-скелета) и не заменяют ТЗ tz-handoff_v4.md.

- L2 backend инициализирован как Node.js 20 / TypeScript / Express проект.
- Единственный рабочий эндпоинт на этом под-шаге: `GET /healthz`.
- `POST /capture`, Firestore-интеграция, Firebase Auth, GitHub push-пайплайн
  и extension layer (L1) добавляются в следующих итерациях (B-J) согласно
  обязывающему плану реализации.
- Регион Cloud Run зафиксирован как `us-east1` и проверяется на старте
  процесса через `assertExpectedRegion`.