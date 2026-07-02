# html_timetable_editor
<img width="941" height="786" alt="image" src="https://github.com/user-attachments/assets/f747b99a-37c2-4c2f-ae30-1b7b63d64074" />
# 📚 School Timetable Builder – Multi‑Class Edition

A powerful, intuitive web app for school principals and administrators to design, edit, and manage weekly timetables for multiple class‑sections simultaneously.  
Built with vanilla HTML, CSS, and JavaScript – runs entirely in your browser, with **local storage** persistence and **CSV import/export**.

---

## 🎯 For School Principals & Administrators

### ✨ Key Features

- **Bulk timetable creation** – import your teachers, class‑sections, and subjects from CSV files.
- **Multi‑class view** – select several classes at once and edit their timetables side by side.
- **Live conflict detection** – teacher overlaps are highlighted in **red** with a warning icon; conflict count is always visible.
- **Quick bulk editing** – click on a period number (P1–P7) to apply the same subject and teacher to **all days** of the week for that period.
- **Copy / Paste / Clear** – right‑click any filled cell to copy its content, paste it into another cell, or clear it.
- **Real‑time statistics** – see totals, coverage, per‑class, per‑teacher, and per‑subject breakdowns in the floating sidebar.
- **Export** – download the entire timetable as a CSV file for reporting or backup.
- **All data saved automatically** in your browser – close and reopen the page, and your timetable is still there.

---

### 🚀 Getting Started (for Principals)

1. **Open the app** – just double‑click the `index.html` file in your browser (Chrome, Edge, Firefox, or Safari).
2. **Import your data**:
   - Click the **📥 Import** button (top‑left).
   - Upload your CSV files:
     - `teacher-list.csv` (columns: `Teacher ID, Teacher Name, Class Teacher Subject, Class Teacher Grade, Class Teacher Section, Phone, Email`)
     - `class-sections.csv` (columns: `Class, Section`)
     - `subject-code-final.csv` (columns: `Subject Code, Subject Name`)
   - Click **Import All** – the app will create a timetable grid for every class‑section.
3. **Select classes** – use the multi‑select dropdown (hold `Ctrl`/`Cmd` to choose multiple). Each selected class appears in its own card.
4. **Edit periods**:
   - **Single cell** – click any cell to open the editor, choose a subject and teacher, and save.
   - **Whole period (all days)** – click the period number (P1‑P7) at the left of any row. The bulk editor will apply your choice to that period for every day of the week.
   - **Right‑click** any filled cell to copy, paste, or clear it.
5. **Watch conflicts** – if a teacher is assigned to two different classes at the same time, those cells turn red and a warning appears. Adjust them until all conflicts are resolved.
6. **Export** – click **📤 Export CSV** to download the complete timetable.

> 💡 **Tip:** The sidebar (right) shows detailed statistics – scroll through it to see how many periods each class, teacher, or subject has per day and per week.

---

## 👨‍💻 For Developers

### Architecture Overview

The app is a **single‑page application** (SPA) written in plain JavaScript. All logic is contained in one HTML file (with embedded CSS and JS). No frameworks, no build tools – just open and run.

### Data Model

```javascript
state = {
  teachers: { 
    id: { id, name, subject, grade, section, phone, email } 
  },
  classSections: [ { grade, section } ],
  subjects: { code: { code, name } },
  timetable: { 
    "I-A": [ // day index 0..4 (Monday..Friday)
      [ null, { subject: "ENG", teacher: "T01" }, null, ... ] // 7 periods
    ]
  },
  loaded: true,
  selectedClasses: [ "I-A", "II-B" ] // for multi‑view
}
```

### Core Functions

| Function | Description |
|----------|-------------|
| `saveState()` / `loadState()` | Persists `state` to `localStorage`. |
| `detectConflicts()` | Returns an array of teacher‑overlap conflicts. |
| `setCell(classKey, day, period, subject, teacher)` | Updates a single cell and triggers re‑render. |
| `applyPeriodToAllDays(classKey, period, subject, teacher)` | Fills the same period across all weekdays. |
| `renderAll()` | Re‑renders the entire UI (top bar, bottom bar, sidebar, timetable cards). |
| `performImport()` | Parses uploaded CSV files and populates the state. |
| `exportCSV()` | Generates a CSV export of all timetable data. |

### Styling & Responsiveness

- The UI uses **CSS Grid** and **Flexbox** for a fluid, responsive layout.
- Media queries adapt the interface for tablets and phones (sidebar collapses, cards stack).
- Floating bars (top/bottom) and sidebar are positioned with `fixed` to stay accessible while scrolling.

### CSV Import / Export

- **Import** – uses a custom CSV parser that handles quoted fields. Expects the exact column headers as specified in the sample files.
- **Export** – outputs a CSV with columns: `Class, Day, Period, Subject Code, Subject Name, Teacher ID, Teacher Name`.

### Keyboard Shortcuts & Interaction

- `Escape` – closes any open editor or modal.
- `Ctrl`+`click` (or `Cmd`+`click`) – select multiple classes in the dropdown.

### Development Notes

- No external libraries – all code is self‑contained.
- To change the school week structure, modify the `DAYS` and `PERIODS` constants at the top of the `<script>` block.
- The app is designed to work offline once loaded – perfect for schools with limited internet.

---

## 📦 Installation & Setup

1. Clone or download the `index.html` file.
2. Place it in any folder on your computer or web server.
3. Open it in a modern web browser (Chrome, Edge, Firefox, Safari).
4. (Optional) Prepare your CSV files using the templates provided in the original attachment.

No server, database, or network connection required – everything runs client‑side.

---

## ❓ Troubleshooting

- **My imported data doesn’t appear** – ensure your CSV files use the correct column headers and are saved as plain UTF‑8 CSV.
- **Conflicts not showing** – conflicts are only detected for teachers; make sure each teacher has a unique ID and that you’ve assigned them properly.
- **Changes not saving** – check that your browser allows `localStorage` (it’s enabled by default). If you clear your browser cache, data will be lost – use **Export CSV** regularly.
