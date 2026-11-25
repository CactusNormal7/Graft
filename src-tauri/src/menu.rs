//! Native menu bar: File / Edit / View / Window, plus the application menu on
//! macOS. Shipping targets are macOS (system menu bar) and Windows (window
//! menu); Linux gets the same menu as Windows as a by-product.
//!
//! Custom items carry the id of a frontend command (`src/commands.ts`); a click
//! is forwarded to the webview as a `menu-action` event, which runs the same
//! command the ⌘K palette would. Accelerators use `CmdOrCtrl`, i.e. Cmd on
//! macOS and Ctrl on Windows.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event carrying the id of the clicked menu item to the webview.
pub const MENU_EVENT: &str = "menu-action";

/// A custom menu item bound to a frontend command.
pub struct CommandItem {
    pub id: &'static str,
    pub label: &'static str,
    pub accelerator: Option<&'static str>,
}

const fn item(id: &'static str, label: &'static str, accelerator: Option<&'static str>) -> CommandItem {
    CommandItem { id, label, accelerator }
}

pub const FILE_PROJECT: &[CommandItem] = &[
    item("project.new", "New Project…", Some("CmdOrCtrl+N")),
    item("project.open", "Open Project…", Some("CmdOrCtrl+O")),
];
pub const FILE_NEW_BLOCK: &[CommandItem] = &[
    item("block.new.query", "Query", None),
    item("block.new.migration", "Migration", None),
    item("block.new.procedure", "Stored Procedure", None),
    item("block.new.trigger", "Trigger", None),
    item("block.new.view", "View", None),
    item("block.new.script", "Script", None),
];
pub const FILE_CANVAS: &[CommandItem] = &[
    item("group.new", "New Group", None),
    item("page.new", "New Page", None),
];
pub const FILE_SAVE: &[CommandItem] = &[item("project.save", "Save", Some("CmdOrCtrl+S"))];
pub const FILE_DATA: &[CommandItem] = &[item("data.import", "Import Data File…", None)];
pub const FILE_HOME: &[CommandItem] = &[
    item("claude.install", "Install in Claude Desktop…", None),
    item("app.home", "Home Screen", Some("CmdOrCtrl+Shift+H")),
];
pub const EDIT_SQL: &[CommandItem] = &[
    item("block.run", "Run Block", Some("CmdOrCtrl+Enter")),
    item("block.runAll", "Run All Blocks", Some("CmdOrCtrl+Shift+Enter")),
    item("sql.format", "Format SQL", Some("Shift+Alt+F")),
];
pub const VIEW_PALETTE: &[CommandItem] = &[item("view.palette", "Command Palette…", Some("CmdOrCtrl+K"))];
pub const VIEW_ZOOM: &[CommandItem] = &[
    item("view.zoomIn", "Zoom In", Some("CmdOrCtrl+=")),
    item("view.zoomOut", "Zoom Out", Some("CmdOrCtrl+-")),
    item("view.fit", "Fit Canvas", Some("CmdOrCtrl+0")),
];
pub const VIEW_SCHEMA: &[CommandItem] = &[
    item("schema.refresh", "Refresh Schema", None),
    item("canvas.addReferencedTables", "Add Referenced Tables to Canvas", None),
];

/// Every custom item, for event routing checks and tests.
pub const ALL_ITEMS: &[&[CommandItem]] = &[
    FILE_PROJECT,
    FILE_NEW_BLOCK,
    FILE_CANVAS,
    FILE_SAVE,
    FILE_DATA,
    FILE_HOME,
    EDIT_SQL,
    VIEW_PALETTE,
    VIEW_ZOOM,
    VIEW_SCHEMA,
];

/// Handles of the custom items, so their enabled state can follow the app's
/// context (`set_menu_states`).
pub struct CommandMenuItems<R: Runtime>(Mutex<HashMap<String, MenuItem<R>>>);

fn is_command_id(id: &str) -> bool {
    ALL_ITEMS.iter().flat_map(|items| items.iter()).any(|item| item.id == id)
}

/// Append a group of command items to a submenu builder.
fn with_items<'a, R: Runtime>(
    app: &AppHandle<R>,
    mut builder: SubmenuBuilder<'a, R, AppHandle<R>>,
    items: &[CommandItem],
) -> tauri::Result<SubmenuBuilder<'a, R, AppHandle<R>>> {
    for entry in items {
        let menu_item = MenuItem::with_id(app, entry.id, entry.label, true, entry.accelerator)?;
        builder = builder.item(&menu_item);
        if let Some(handles) = app.try_state::<CommandMenuItems<R>>() {
            handles.0.lock().unwrap_or_else(|e| e.into_inner()).insert(entry.id.to_string(), menu_item);
        }
    }
    Ok(builder)
}

/// Application menu (macOS convention: About, Services, Hide…, Quit).
#[cfg(target_os = "macos")]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Graft")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

fn file_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let new_block = with_items(app, SubmenuBuilder::new(app, "New Block"), FILE_NEW_BLOCK)?.build()?;
    let mut builder = with_items(app, SubmenuBuilder::new(app, "File"), FILE_PROJECT)?
        .separator()
        .item(&new_block);
    builder = with_items(app, builder, FILE_CANVAS)?.separator();
    builder = with_items(app, builder, FILE_SAVE)?.separator();
    builder = with_items(app, builder, FILE_DATA)?.separator();
    builder = with_items(app, builder, FILE_HOME)?;
    // Windows convention: Exit closes the File menu (macOS quits from the app menu).
    #[cfg(not(target_os = "macos"))]
    {
        let exit = tauri::menu::PredefinedMenuItem::quit(app, Some("Exit"))?;
        builder = builder.separator().item(&exit);
    }
    builder.build()
}

fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    // The predefined clipboard items are what makes Cmd+C/V/X/A work in the
    // webview on macOS.
    let builder = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator();
    with_items(app, builder, EDIT_SQL)?.build()
}

fn view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let mut builder = with_items(app, SubmenuBuilder::new(app, "View"), VIEW_PALETTE)?.separator();
    builder = with_items(app, builder, VIEW_ZOOM)?.separator();
    builder = with_items(app, builder, VIEW_SCHEMA)?;
    #[cfg(target_os = "macos")]
    {
        builder = builder.separator().fullscreen();
    }
    builder.build()
}

fn window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let builder = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window();
    #[cfg(target_os = "macos")]
    let builder = builder.separator().bring_all_to_front();
    let menu = builder.build()?;
    #[cfg(target_os = "macos")]
    menu.set_as_windows_menu_for_nsapp()?;
    Ok(menu)
}

/// Build the whole menu bar for the current platform.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    app.manage(CommandMenuItems::<R>(Mutex::new(HashMap::new())));
    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    menu.append(&app_menu(app)?)?;
    let submenus = [file_menu(app)?, edit_menu(app)?, view_menu(app)?, window_menu(app)?];
    for submenu in &submenus {
        menu.append(submenu)?;
    }
    Ok(menu)
}

/// Grey out / enable custom items to match what the app can do right now
/// (e.g. canvas commands on the home screen). Unknown ids are ignored.
#[tauri::command]
pub fn set_menu_states<R: Runtime>(
    app: AppHandle<R>,
    states: HashMap<String, bool>,
) -> Result<(), String> {
    let handles = app.state::<CommandMenuItems<R>>();
    let items = handles.0.lock().unwrap_or_else(|e| e.into_inner());
    for (id, enabled) in states {
        if let Some(item) = items.get(&id) {
            item.set_enabled(enabled).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Forward a click on a custom item to the webview; predefined items (copy,
/// quit…) are handled natively and never reach here with a command id.
pub fn forward_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if is_command_id(id) {
        if let Err(err) = app.emit(MENU_EVENT, id) {
            eprintln!("menu: could not forward {id}: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn all_items() -> impl Iterator<Item = &'static CommandItem> {
        ALL_ITEMS.iter().flat_map(|items| items.iter())
    }

    #[test]
    fn ids_and_accelerators_are_unique() {
        let mut ids = HashSet::new();
        let mut accelerators = HashSet::new();
        for entry in all_items() {
            assert!(ids.insert(entry.id), "duplicate id {}", entry.id);
            if let Some(accelerator) = entry.accelerator {
                assert!(accelerators.insert(accelerator), "duplicate {accelerator}");
            }
        }
    }

    /// Every menu item must run a frontend command, or its click does nothing.
    #[test]
    fn every_item_maps_to_a_frontend_command() {
        let commands = include_str!("../../src/commands.ts");
        for entry in all_items() {
            let block_type = entry.id.strip_prefix("block.new.");
            let declared = commands.contains(&format!("\"{}\"", entry.id))
                || block_type.is_some_and(|t| commands.contains(&format!("\"{t}\"")));
            assert!(declared, "{} has no command in src/commands.ts", entry.id);
        }
    }

    /// Labels shown by the palette (`SHORTCUTS`, `Mod+…`) must match the menu.
    #[test]
    fn accelerators_match_the_frontend_shortcuts() {
        let commands = include_str!("../../src/commands.ts");
        for accelerator in all_items().filter_map(|entry| entry.accelerator) {
            let frontend_form = accelerator.replace("CmdOrCtrl", "Mod");
            assert!(
                commands.contains(&format!("\"{frontend_form}\"")),
                "{accelerator} is missing from SHORTCUTS in src/commands.ts"
            );
        }
    }

    #[test]
    fn only_command_ids_are_forwarded() {
        assert!(is_command_id("project.save"));
        assert!(!is_command_id("quit"));
    }
}
