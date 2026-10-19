const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

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

    const encoded = auth.split(" ")[1];

    const decoded =
        Buffer.from(encoded, "base64").toString("utf8");

    const [username, password] =
        decoded.split(":");

    if (
        username !== "admin" ||
        password !== "Vishal@123"
    ) {

        res.setHeader(
            "WWW-Authenticate",
            'Basic realm="Gallery Admin"'
        );

        return res.status(401).send("Wrong username or password");
    }

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "admin.html"
        )
    );
});

// =========================
// UPLOAD FOLDER
// =========================

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

app.use("/uploads", express.static(uploadDir));

// =========================
// MYSQL
// =========================

const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "123456789",
    database: "gallery_admin"
});

db.connect((err) => {

    if (err) {
        console.error(
            "MySQL connection failed:",
            err
        );
        return;
    }

    console.log(
        "MySQL Connected Successfully!"
    );
});

// =========================
// MULTER IMAGE UPLOAD
// =========================

const storage = multer.diskStorage({

    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {

        const ext =
            path.extname(file.originalname);

        const filename =
            Date.now() +
            "-" +
            Math.round(Math.random() * 1e9) +
            ext;

        cb(null, filename);
    }

});

const upload = multer({

    storage: storage,

    fileFilter: (req, file, cb) => {

        const allowed = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/gif"
        ];

        if (allowed.includes(file.mimetype)) {

            cb(null, true);

        } else {

            cb(
                new Error(
                    "Only image files are allowed"
                )
            );

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

            console.error(err);

            return res.status(500).json({
                error: err.message
            });
        }

        res.json(results);
    });
});

// =========================
// ADD NEW IMAGE
// =========================

app.post(
    "/api/gallery",
    upload.single("image"),
    (req, res) => {

        if (!req.file) {

            return res.status(400).json({
                error: "Please select an image"
            });
        }

        const imageUrl =
            `/uploads/${req.file.filename}`;

        const title =
            req.body.title || "";

        const sql = `
            INSERT INTO gallery
            (image_url, title)
            VALUES (?, ?)
        `;

        db.query(
            sql,
            [imageUrl, title],
            (err, result) => {

                if (err) {

                    console.error(err);

                    if (
                        fs.existsSync(
                            req.file.path
                        )
                    ) {
                        fs.unlinkSync(
                            req.file.path
                        );
                    }

                    return res.status(500).json({
                        error: err.message
                    });
                }

                res.json({
                    success: true,
                    id: result.insertId,
                    image_url: imageUrl,
                    title: title
                });
            }
        );
    }
);

// =========================
// EDIT CAPTION / TITLE
// =========================

app.put(
    "/api/gallery/:id",
    (req, res) => {

        const id =
            req.params.id;

        const title =
            req.body.title || "";

        const sql = `
            UPDATE gallery
            SET title = ?
            WHERE id = ?
        `;

        db.query(
            sql,
            [title, id],
            (err, result) => {

                if (err) {

                    console.error(err);

                    return res.status(500).json({
                        error: err.message
                    });
                }

                if (
                    result.affectedRows === 0
                ) {

                    return res.status(404).json({
                        error:
                            "Gallery image not found"
                    });
                }

                res.json({
                    success: true
                });
            }
        );
    }
);

// =========================
// REPLACE IMAGE
// =========================

app.put(
    "/api/gallery/:id/image",
    upload.single("image"),
    (req, res) => {

        if (!req.file) {

            return res.status(400).json({
                error:
                    "Please select a new image"
            });
        }

        const id =
            req.params.id;

        const selectSql = `
            SELECT image_url
            FROM gallery
            WHERE id = ?
        `;

        db.query(
            selectSql,
            [id],
            (err, results) => {

                if (err) {

                    if (
                        fs.existsSync(
                            req.file.path
                        )
                    ) {
                        fs.unlinkSync(
                            req.file.path
                        );
                    }

                    return res.status(500).json({
                        error: err.message
                    });
                }

                if (
                    results.length === 0
                ) {

                    if (
                        fs.existsSync(
                            req.file.path
                        )
                    ) {
                        fs.unlinkSync(
                            req.file.path
                        );
                    }

                    return res.status(404).json({
                        error:
                            "Gallery image not found"
                    });
                }

                const oldImage =
                    results[0].image_url;

                const newImage =
                    `/uploads/${req.file.filename}`;

                const updateSql = `
                    UPDATE gallery
                    SET image_url = ?
                    WHERE id = ?
                `;

                db.query(
                    updateSql,
                    [newImage, id],
                    (updateErr) => {

                        if (updateErr) {

                            if (
                                fs.existsSync(
                                    req.file.path
                                )
                            ) {
                                fs.unlinkSync(
                                    req.file.path
                                );
                            }

                            return res.status(500).json({
                                error:
                                    updateErr.message
                            });
                        }

                        if (
                            oldImage &&
                            oldImage.startsWith(
                                "/uploads/"
                            )
                        ) {

                            const oldFile =
                                path.join(
                                    __dirname,
                                    oldImage
                                );

                            if (
                                fs.existsSync(
                                    oldFile
                                )
                            ) {
                                fs.unlinkSync(
                                    oldFile
                                );
                            }
                        }

                        res.json({
                            success: true,
                            image_url: newImage
                        });
                    }
                );
            }
        );
    }
);

// =========================
// DELETE IMAGE
// =========================

app.delete(
    "/api/gallery/:id",
    (req, res) => {

        const id =
            req.params.id;

        const selectSql = `
            SELECT image_url
            FROM gallery
            WHERE id = ?
        `;

        db.query(
            selectSql,
            [id],
            (err, results) => {

                if (err) {

                    return res.status(500).json({
                        error: err.message
                    });
                }

                if (
                    results.length === 0
                ) {

                    return res.status(404).json({
                        error:
                            "Gallery image not found"
                    });
                }

                const imageUrl =
                    results[0].image_url;

                const deleteSql = `
                    DELETE FROM gallery
                    WHERE id = ?
                `;

                db.query(
                    deleteSql,
                    [id],
                    (deleteErr) => {

                        if (deleteErr) {

                            return res.status(500).json({
                                error:
                                    deleteErr.message
                            });
                        }

                        if (
                            imageUrl &&
                            imageUrl.startsWith(
                                "/uploads/"
                            )
                        ) {

                            const filePath =
                                path.join(
                                    __dirname,
                                    imageUrl
                                );

                            if (
                                fs.existsSync(
                                    filePath
                                )
                            ) {
                                fs.unlinkSync(
                                    filePath
                                );
                            }
                        }

                        res.json({
                            success: true
                        });
                    }
                );
            }
        );
    }
);

// =========================
// ERROR HANDLER
// =========================

app.use(
    (err, req, res, next) => {

        console.error(err);

        res.status(500).json({
            error:
                err.message ||
                "Something went wrong"
        });
    }
);

// =========================
// START SERVER
// =========================

app.listen(
    PORT,
    () => {

        console.log(
            `Server running at http://localhost:${PORT}`
        );

    }
);