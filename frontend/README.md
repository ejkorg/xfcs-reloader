# XFCS Reloader Frontend

Angular frontend for XFCS Reloader.

## Run
- `npm install`
- `npm start`

## Production build for nginx subpath
- `npm run build:prod:deploy`

This generates assets with URLs rooted at `/xfcs-reloader/` (for nginx location `/xfcs-reloader/`).

Expected backends:
- XFCS backend: `http://127.0.0.1:8005/xfcs-reloader`
- DTP auth backend: `http://127.0.0.1:8004/resender`
