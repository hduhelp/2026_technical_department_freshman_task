import postgres from "postgres"
const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres", { onnotice: () => {} })

const tables = await sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname`
console.log("表:", tables.map(t => t.relname + (t.relrowsecurity ? "(RLS)" : "")).join(", "))

const fns = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' order by p.proname`
console.log("函数:", fns.map(f => f.proname).join(", "))

const readable = await sql`select column_name from information_schema.column_privileges where table_schema='public' and table_name='found_items' and grantee='authenticated' and privilege_type='SELECT' order by column_name`
console.log("found_items 客户端可读列:", readable.map(c => c.column_name).join(", "))

const writable = await sql`select distinct privilege_type from information_schema.column_privileges where table_schema='public' and table_name in ('found_items','found_item_images','pickups') and grantee='authenticated'`
console.log("上述三表的客户端权限类型:", writable.map(w => w.privilege_type).join(", ") || "(无)")

const pol = await sql`select tablename, policyname, cmd from pg_policies where schemaname='public' order by tablename, policyname`
console.log("策略:")
for (const p of pol) console.log("  " + p.tablename + " | " + p.policyname + " | " + p.cmd)

const cfg = await sql`select max_photos, page_size from public.app_config`
console.log("app_config:", JSON.stringify(cfg[0]))
await sql.end()
