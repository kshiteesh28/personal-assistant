const payload = {
  title: "Debug Task Repro",
  priority: 2,
  status: "todo",
  due_ts: Date.now() + 3600000,
  time_estimate: 30,
  is_splittable: false
};

async function repro() {
  console.log("Testing POST /api/tasks...");
  const res = await fetch("http://localhost:3000/api/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer dev"
    },
    body: JSON.stringify(payload)
  });

  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text);

  console.log("\nTesting POST /api/notes...");
  const nres = await fetch("http://localhost:3000/api/notes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer dev"
    },
    body: JSON.stringify({ title: "Debug Note Repro", body: "Test" })
  });
  console.log("Status:", nres.status);
  console.log("Response:", await nres.text());
}

repro().catch(console.error);
