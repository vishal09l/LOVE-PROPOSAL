
require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// BASIC SETUP
// =========================

app.use(cors());
app.use(express.json());

// Serve main website files
app.use(express.static(__dirname));

// =========================
// ADMIN PAGE - PASSWORD PROTECTED
// =========================

app.get("/admin.html", (req, res) => {
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith("Basic ")) {
        res.setHeader(
            "WWW-Authenticate",
            'Basic realm="Gallery Admin"'
        );
        return res.status(401).send("Authentication required");
    }

    let decoded;

    try {
        decoded = Buffer.from(
            auth.split(" ")[1],
            "base64"
        ).toString("utf8");
    } catch {
        return res.status(401).send("Invalid credentials");
    }

    const separatorIndex = decoded.indexOf(":");
    const username = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (
        username !== process.env.ADMIN_USERNAME ||
        password !== process.env.ADMIN_PASSWORD
    ) {
        res.setHeader(
            "WWW-Authenticate",
            'Basic realm="Gallery Admin"'
        );
        return res.status(401).send("Wrong username or password");
    }

    res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// =========================
// UPLOAD FOLDER
// =========================

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use("/uploads", express.static(uploadDir));

// =========================
// MYSQL - AIVEN CLOUD
// =========================

const db = mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {
        ca: fs.readFileSync(
            path.join(__dirname, "ca.pem"),
            "utf8"
        ),
        rejectUnauthorized: true
    }
});

db.connect((err) => {
    if (err) {
        console.error("MySQL connection failed:", err.message);
        return;
    }

    console.log("Aiven MySQL Connected Successfully!");
});

// =========================
// MULTER IMAGE UPLOAD
// =========================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const filename =
            Date.now() +
            "-" +
            Math.round(Math.random() * 1e9) +
            ext;

        cb(null, filename);
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
        ];

        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG, PNG, WEBP and GIF images are allowed"));
        }
    }
});

// =========================
// GET ALL GALLERY IMAGES
// =========================

app.get("/api/gallery", (req, res) => {
    const sql = `
        SELECT *
        FROM gallery
        ORDER BY id DESC
    `;

    db.query(sql, (err, results) => {
        if (err) {
            console.error("Gallery query failed:", err.message);
            return res.status(500).json({
                error: "Unable to load gallery"
            });
        }

        res.json(results);
    });
});

// =========================
// ADD NEW IMAGE
// =========================

app.post("/api/gallery", upload.single("image"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({
            error: "Please select an image"
        });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    const title = req.body.title || "";

    const sql = `
        INSERT INTO gallery (image_url, title)
        VALUES (?, ?)
    `;

    db.query(sql, [imageUrl, title], (err, result) => {
        if (err) {
            console.error("Gallery insert failed:", err.message);

            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(500).json({
                error: "Unable to save gallery image"
            });
        }

        res.json({
            success: true,
            id: result.insertId,
            image_url: imageUrl,
            title
        });
    });
});

// =========================
// EDIT CAPTION / TITLE
// =========================

app.put("/api/gallery/:id", (req, res) => {
    const id = req.params.id;
    const title = req.body.title || "";

    const sql = `
        UPDATE gallery
        SET title = ?
        WHERE id = ?
    `;

    db.query(sql, [title, id], (err, result) => {
        if (err) {
            console.error("Title update failed:", err.message);
            return res.status(500).json({
                error: "Unable to update caption"
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Gallery image not found"
            });
        }

        res.json({ success: true });
    });
});

// =========================
// REPLACE IMAGE
// =========================

app.put(
    "/api/gallery/:id/image",
    upload.single("image"),
    (req, res) => {
        if (!req.file) {
            return res.status(400).json({
                error: "Please select a new image"
            });
        }

        const id = req.params.id;

        const selectSql = `
            SELECT image_url
            FROM gallery
            WHERE id = ?
        `;

        db.query(selectSql, [id], (err, results) => {
            if (err) {
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }

                console.error("Image lookup failed:", err.message);
                return res.status(500).json({
                    error: "Unable to find existing image"
                });
            }

            if (results.length === 0) {
                if (fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }

                return res.status(404).json({
                    error: "Gallery image not found"
                });
            }

            const oldImage = results[0].image_url;
            const newImage = `/uploads/${req.file.filename}`;

            const updateSql = `
                UPDATE gallery
                SET image_url = ?
                WHERE id = ?
            `;

            db.query(updateSql, [newImage, id], (updateErr) => {
                if (updateErr) {
                    if (fs.existsSync(req.file.path)) {
                        fs.unlinkSync(req.file.path);
                    }

                    console.error("Image update failed:", updateErr.message);
                    return res.status(500).json({
                        error: "Unable to replace image"
                    });
                }

                if (oldImage && oldImage.startsWith("/uploads/")) {
                    const oldFile = path.join(
                        uploadDir,
                        path.basename(oldImage)
                    );

                    if (fs.existsSync(oldFile)) {
                        fs.unlinkSync(oldFile);
                    }
                }

                res.json({
                    success: true,
                    image_url: newImage
                });
            });
        });
    }
);

// =========================
// DELETE IMAGE
// =========================

app.delete("/api/gallery/:id", (req, res) => {
    const id = req.params.id;

    const selectSql = `
        SELECT image_url
        FROM gallery
        WHERE id = ?
    `;

    db.query(selectSql, [id], (err, results) => {
        if (err) {
            console.error("Image lookup failed:", err.message);
            return res.status(500).json({
                error: "Unable to find gallery image"
            });
        }

        if (results.length === 0) {
            return res.status(404).json({
                error: "Gallery image not found"
            });
        }

        const imageUrl = results[0].image_url;

        const deleteSql = `
            DELETE FROM gallery
            WHERE id = ?
        `;

        db.query(deleteSql, [id], (deleteErr) => {
            if (deleteErr) {
                console.error("Image deletion failed:", deleteErr.message);
                return res.status(500).json({
                    error: "Unable to delete gallery image"
                });
            }

            if (imageUrl && imageUrl.startsWith("/uploads/")) {
                const filePath = path.join(
                    uploadDir,
                    path.basename(imageUrl)
                );

                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            res.json({ success: true });
        });
    });
});

// =========================
// ERROR HANDLER
// =========================

app.use((err, req, res, next) => {
    console.error("Request error:", err.message);

    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            error: err.code === "LIMIT_FILE_SIZE"
                ? "Image must be 5 MB or smaller"
                : "Image upload failed"
        });
    }

    res.status(400).json({
        error: err.message || "Something went wrong"
    });
});

// =========================
// START SERVER
// =========================

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
