use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub palette: i64,
    pub sort_order: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub category_id: i64,
    pub unit: String,
    pub owned_qty: i64,
    pub archived: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Movement {
    pub id: i64,
    pub item_id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub qty: i64,
    pub date: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllData {
    pub categories: Vec<Category>,
    pub items: Vec<Item>,
    pub movements: Vec<Movement>,
    pub db_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovementLine {
    pub item_id: i64,
    pub qty: i64,
}
