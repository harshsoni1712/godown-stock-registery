use rusqlite::{params, Connection};
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // Single-file db (no -wal/-shm sidecars) so Backup/Restore only ever
    // has to move one file around.
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            palette INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category_id INTEGER NOT NULL REFERENCES categories(id),
            unit TEXT NOT NULL DEFAULT 'nos',
            owned_qty INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES items(id),
            type TEXT NOT NULL CHECK(type IN ('OUT','IN')),
            qty INTEGER NOT NULL CHECK(qty > 0),
            date TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_movements_date ON movements(date);
        CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
        CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_id);
        ",
    )?;

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))?;
    if count == 0 {
        seed_default_categories(conn)?;
    }
    Ok(())
}

pub fn seed_default_categories(conn: &Connection) -> rusqlite::Result<()> {
    let defaults: [(&str, i64); 5] = [
        ("Plates", 0),
        ("Ballies", 1),
        ("Fiber Sheet", 2),
        ("Props & Jacks", 3),
        ("Spans", 4),
    ];
    for (i, (name, palette)) in defaults.iter().enumerate() {
        conn.execute(
            "INSERT INTO categories (name, palette, sort_order) VALUES (?1, ?2, ?3)",
            params![name, palette, i as i64],
        )?;
    }
    Ok(())
}
