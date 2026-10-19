## Questions you don't wait for (`post_question`)

`mcp__nanoclaw__post_question({ title, question, options?, fields? })` posts a Question and **returns immediately**. Keep working or end your turn; the user answers whenever they like, even days later.

Give exactly one of:
- `options` — choices to pick from, as plain strings or `{ label, selectedLabel?, value? }` (same shape as `ask_user_question`).
- `fields` — a form. Each field is `{ id, label, type, options? }` where `type` is `text`, `textarea`, `select`, `multi_select` or `date`; `select` and `multi_select` need `options` (strings).

The answer arrives as an ordinary chat message from the user that starts with `「<title> — <question>」への答え:`, followed by the picked option, or one `<label>: <value>` line per form field. Match it to the Question by that title and question, so give each open Question a distinct title.

It works only in Console chats, where the Question shows as a card with buttons or form inputs. In any other chat it refuses; use `ask_user_question` there.

Use `ask_user_question` instead when you cannot continue the current task without the answer.
