# HDU Lost and Found Design

## Goal

Build a locally demonstrable Hangzhou Dianzi University lost-and-found site that lets registered students publish, find, manage, and contact posters about lost or found items.

## Scope

- Register, log in, get the current user, and log out.
- Create, read, update, and delete a user's own lost/found posts.
- Browse other users' posts with keyword search, filtering, sorting, and pagination.
- Move a post through `searching`, `found`, and `closed`; only its author can change it.
- Show a public contact method on each post so users can contact the owner or finder.

## Deliberate Limits

- No real campus identity verification, image upload, chat, email/SMS delivery, admin dashboard, or recommendation algorithm.
- Logout removes the browser token. JWTs remain valid until their short expiry, which is acceptable for this interview demo.

## Architecture

One Go process serves both the JSON API and the static browser app. Gin routes requests; middleware validates the JWT and places the current user ID in the request context. GORM uses SQLite (`lost_found.db`) to persist users and posts without an external database service.

The frontend is a small single-page interface using browser `fetch`. It stores the JWT in `localStorage`, sends it as a Bearer token for protected calls, and renders the response data without a frontend framework.

## Data Model

`User`: ID, username (unique), password hash, created time.

`Post`: ID, author ID, type (`lost` or `found`), item name, location, happened-at time, description, contact, status (`searching`, `found`, `closed`), created time, updated time.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | Create an account. |
| POST | `/api/auth/login` | Verify credentials and return a JWT. |
| GET | `/api/auth/me` | Return the JWT's user. |
| POST | `/api/auth/logout` | Acknowledge logout; client removes JWT. |
| GET | `/api/posts` | Public list; supports `q`, `type`, `status`, `page`, `page_size`. |
| POST | `/api/posts` | Create a post as the logged-in user. |
| GET | `/api/posts/:id` | Read one public post. |
| PUT | `/api/posts/:id` | Update a post owned by the caller. |
| DELETE | `/api/posts/:id` | Delete a post owned by the caller. |
| PATCH | `/api/posts/:id/status` | Advance an owned post's status. |

The list query uses `WHERE` for type/status, `LIKE` for keyword matching, `ORDER BY created_at DESC` for newest-first results, and `LIMIT` plus `OFFSET` for paging.

## Browser Flow

An anonymous visitor can browse, search, and open post details. Registration or login reveals the publishing form and “My posts.” A post card exposes edit/delete/status controls only when `author_id` equals the current user ID. Details always show the poster's supplied contact method.

## Validation and Security

Usernames and passwords must be non-empty. Post fields required by the demo are type, item name, location, happened-at time, description, and contact. Passwords are bcrypt hashes. Protected routes reject missing or invalid JWTs; ownership checks reject attempts to modify someone else's post. Status can only advance one step: `searching` → `found` → `closed`.

## Verification

Go integration tests will exercise registration/login/current-user, protected ownership behavior, status transitions, and filtered/paginated post queries using a temporary SQLite database. A final manual smoke test will run the server and call the public page and API.
