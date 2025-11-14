import fs from "fs";
import path from "path";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const outPath = path.join(process.cwd(), "constant/output.js");
  const data = req.body.clips;

  fs.writeFileSync(
    outPath,
    "export default ClipsData =" + JSON.stringify(data, null, 2) + ";\n",
    "utf8"
  );

  res.status(200).json({ ok: true });
}
