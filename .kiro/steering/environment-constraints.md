# Environment Constraints

## Runtime Limitations

- Node.js is NOT installed on this machine. Do NOT run `npm`, `npx`, or any Node-based CLI commands (e.g. `ng test`, `ng build`, `jest`, `vitest`).
- Java is NOT installed on this machine. Do NOT run `mvn`, `gradle`, `java`, or any JVM-based commands.

## Consequences

- Frontend tests (Karma/Jasmine, Jest) cannot be executed in this environment.
- Backend tests (JUnit, Maven Surefire) cannot be executed in this environment.
- When a task requires running tests, write the test code and mark the PBT status based on code review rather than execution, or ask the user to run tests manually.
