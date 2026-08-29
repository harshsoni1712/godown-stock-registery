use crate::db;
use crate::models::{AllData, Category, Item, Movement, MovementLine};
use crate::AppState;
use rusqlite::{params, Connection};
use std::path::Path;
use tauri::State;

fn is_valid_date(s: &str) -> bool {
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

fn fetch_categories(conn: &Connection) -> rusqlite::Result<Vec<Category>> {
    let mut stmt = conn
        .prepare("SELECT id, name, palette, sort_order FROM categories ORDER BY sort_order, id")?;
    let rows = stmt.query_map([], |r| {
        Ok(Category {
            id: r.get(0)?,
            name: r.get(1)?,
            palette: r.get(2)?,
            sort_order: r.get(3)?,
        })
    })?;
    rows.collect()
}

fn fetch_items(conn: &Connection) -> rusqlite::Result<Vec<Item>> {
    let mut stmt =
        conn.prepare("SELECT id, name, category_id, unit, owned_qty, archived FROM items ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |r| {
        let archived_i: i64 = r.get(5)?;
        Ok(Item {
            id: r.get(0)?,
            name: r.get(1)?,
            category_id: r.get(2)?,
            unit: r.get(3)?,
            owned_qty: r.get(4)?,
            archived: archived_i != 0,
        })
    })?;
    rows.collect()
}

fn fetch_movements(conn: &Connection) -> rusqlite::Result<Vec<Movement>> {
    let mut stmt =
        conn.prepare("SELECT id, item_id, type, qty, date, created_at FROM movements ORDER BY date DESC, id DESC")?;
    let rows = stmt.query_map([], |r| {
        Ok(Movement {
            id: r.get(0)?,
            item_id: r.get(1)?,
            kind: r.get(2)?,
            qty: r.get(3)?,
            date: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

fn read_all_data(conn: &Connection, db_path: &str) -> rusqlite::Result<AllData> {
    Ok(AllData {
        categories: fetch_categories(conn)?,
        items: fetch_items(conn)?,
        movements: fetch_movements(conn)?,
        db_path: db_path.to_string(),
    })
}

fn unique_violation(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(err, _)
            if err.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

#[tauri::command]
pub fn get_all_data(state: State<AppState>) -> Result<AllData, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    read_all_data(&conn, &state.db_path.to_string_lossy()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_category(
    state: State<AppState>,
    name: String,
    palette: i64,
) -> Result<Category, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Category name can't be empty.".into());
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM categories",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO categories (name, palette, sort_order) VALUES (?1, ?2, ?3)",
        params![name, palette, sort_order],
    )
    .map_err(|e| {
        if unique_violation(&e) {
            "A category with this name already exists.".to_string()
        } else {
            e.to_string()
        }
    })?;
    let id = conn.last_insert_rowid();
    Ok(Category {
        id,
        name,
        palette,
        sort_order,
    })
}

#[tauri::command]
pub fn update_category(
    state: State<AppState>,
    id: i64,
    name: String,
    palette: i64,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Category name can't be empty.".into());
    }
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE categories SET name = ?1, palette = ?2 WHERE id = ?3",
        params![name, palette, id],
    )
    .map_err(|e| {
        if unique_violation(&e) {
            "A category with this name already exists.".to_string()
        } else {
            e.to_string()
        }
    })?;
    Ok(())
}

#[tauri::command]
pub fn delete_category(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM items WHERE category_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n > 0 {
        return Err(format!(
            "Can't delete this category — {n} item(s) still use it. Move or delete them first."
        ));
    }
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_item(
    state: State<AppState>,
    name: String,
    category_id: i64,
    unit: String,
    owned_qty: i64,
) -> Result<Item, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Item name can't be empty.".into());
    }
    if owned_qty < 0 {
        return Err("Owned quantity can't be negative.".into());
    }
    let unit = {
        let u = unit.trim();
        if u.is_empty() {
            "nos".to_string()
        } else {
            u.to_string()
        }
    };
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO items (name, category_id, unit, owned_qty, archived, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![name, category_id, unit, owned_qty, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(Item {
        id,
        name,
        category_id,
        unit,
        owned_qty,
        archived: false,
    })
}

#[tauri::command]
pub fn update_item(
    state: State<AppState>,
    id: i64,
    name: String,
    category_id: i64,
    unit: String,
    owned_qty: i64,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Item name can't be empty.".into());
    }
    if owned_qty < 0 {
        return Err("Owned quantity can't be negative.".into());
    }
    let unit = {
        let u = unit.trim();
        if u.is_empty() {
            "nos".to_string()
        } else {
            u.to_string()
        }
    };
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE items SET name = ?1, category_id = ?2, unit = ?3, owned_qty = ?4 WHERE id = ?5",
        params![name, category_id, unit, owned_qty, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_item_archived(state: State<AppState>, id: i64, archived: bool) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE items SET archived = ?1 WHERE id = ?2",
        params![archived as i64, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_item(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM movements WHERE item_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if n > 0 {
        return Err(format!(
            "Can't delete this item — {n} movement(s) are recorded against it. Archive it instead."
        ));
    }
    conn.execute("DELETE FROM items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_movements(
    state: State<AppState>,
    kind: String,
    date: String,
    lines: Vec<MovementLine>,
) -> Result<Vec<Movement>, String> {
    if kind != "OUT" && kind != "IN" {
        return Err("Invalid movement type.".into());
    }
    if !is_valid_date(&date) {
        return Err("Enter a valid date.".into());
    }
    let lines: Vec<&MovementLine> = lines.iter().filter(|l| l.qty > 0).collect();
    if lines.is_empty() {
        return Err("Enter at least one item with a quantity greater than zero.".into());
    }
    let mut conn = state.conn.lock().map_err(|e| e.to_string())?;
    let created_at = now_iso();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut out = Vec::with_capacity(lines.len());
    for l in &lines {
        tx.execute(
            "INSERT INTO movements (item_id, type, qty, date, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![l.item_id, kind, l.qty, date, created_at],
        )
        .map_err(|e| e.to_string())?;
        let id = tx.last_insert_rowid();
        out.push(Movement {
            id,
            item_id: l.item_id,
            kind: kind.clone(),
            qty: l.qty,
            date: date.clone(),
            created_at: created_at.clone(),
        });
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(out)
}

#[tauri::command]
pub fn delete_movement(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM movements WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Writes a consistent, single-file snapshot of the live database to `dest_path`.
#[tauri::command]
pub fn backup_database(state: State<AppState>, dest_path: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if Path::new(&dest_path).exists() {
        std::fs::remove_file(&dest_path).map_err(|e| e.to_string())?;
    }
    conn.execute("VACUUM INTO ?1", params![dest_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replaces the live database with the contents of `src_path`, after checking
/// it looks like one of our backups. Returns the freshly loaded data.
#[tauri::command]
pub fn restore_database(state: State<AppState>, src_path: String) -> Result<AllData, String> {
    {
        let candidate =
            Connection::open(&src_path).map_err(|e| format!("Can't open that file: {e}"))?;
        let has_tables: i64 = candidate
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('categories', 'items', 'movements')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if has_tables != 3 {
            return Err("That file doesn't look like a Godown Stock Register backup.".into());
        }
    }

    let mut conn_guard = state.conn.lock().map_err(|e| e.to_string())?;
    // Drop the live connection first so the database file isn't locked when
    // we overwrite it (matters most on Windows).
    let placeholder = Connection::open_in_memory().map_err(|e| e.to_string())?;
    let old_conn = std::mem::replace(&mut *conn_guard, placeholder);
    drop(old_conn);

    std::fs::copy(&src_path, &state.db_path).map_err(|e| e.to_string())?;

    let reopened = db::open(&state.db_path).map_err(|e| e.to_string())?;
    *conn_guard = reopened;

    read_all_data(&conn_guard, &state.db_path.to_string_lossy()).map_err(|e| e.to_string())
}
