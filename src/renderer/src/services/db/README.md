# Message Data Access Layer

This module exposes `dbService`, a small facade over `DexieMessageDataSource` for local chat message storage.

The agents SQLite/IPC-backed message source has been removed with the agents subsystem, so message reads and writes now stay on the regular IndexedDB path.

## Usage

```typescript
import { dbService } from '@renderer/services/db'

const { messages, blocks } = await dbService.fetchMessages(topicId)
await dbService.appendMessage(topicId, message, blocks)
await dbService.updateMessage(topicId, messageId, updates)
```
