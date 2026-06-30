// Add the "Project manager" menu. Projects are NOT stored in db.json — they are
// fetched live from the Ignite panel (http://localhost:1234) and proxied by server.js.
// This category is just the sidebar entry + a dedicated live renderer (like Home).
const fs = require("fs"), path = require("path");
const DB = path.join(__dirname, "..", "store", "db.json");
const db = JSON.parse(fs.readFileSync(DB, "utf8"));

if (!db.categories.find((c) => c.id === "projects")) {
  const cat = { id: "projects", label: "Project manager", icon: "🔥", color: "#ff6a13",
    desc: "Projects pulled live from the Ignite panel (localhost:1234). Ongoing = pinned (Home + top). Not stored here — edit in Ignite." };
  const i = db.categories.findIndex((c) => c.id === "todo");
  if (i >= 0) db.categories.splice(i + 1, 0, cat); else db.categories.push(cat);
}

fs.writeFileSync(DB, JSON.stringify(db, null, 2));
console.log("categories:", db.categories.map((c) => c.id).join(", "));
