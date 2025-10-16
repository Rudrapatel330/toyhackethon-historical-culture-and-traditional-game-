const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.')); // Serve static files from current directory

// Initialize SQLite database
const db = new sqlite3.Database('./bharatiya_culture.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    initializeDatabase();
  }
});

// Initialize database tables with better error handling
function initializeDatabase() {
  // Create levels table
  db.run(`CREATE TABLE IF NOT EXISTS levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number INTEGER UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    status TEXT DEFAULT 'locked',
    points INTEGER DEFAULT 100,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`, function(err) {
    if (err) {
      console.error('Error creating levels table:', err);
    } else {
      console.log('Levels table created/verified');
      // Create videos table after levels table
      db.run(`CREATE TABLE IF NOT EXISTS videos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        filename TEXT,
        file_size INTEGER,
        mime_type TEXT,
        video_data TEXT,  // Store base64 encoded video
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (level_id) REFERENCES levels (id)
      )`, function(err) {
        if (err) {
          console.error('Error creating videos table:', err);
        } else {
          console.log('Videos table created/verified');
          insertSampleData();
        }
      });
    }
  });
}

// Insert sample data after tables are created
function insertSampleData() {
  const sampleLevels = [
    { number: 1, title: "Festivals & Celebrations", description: "Explore the vibrant festivals of India", icon: "🎉", status: "available", points: 100 },
    { number: 2, title: "Folk Arts & Music", description: "Discover India's rich folk arts and music", icon: "🎨", status: "locked", points: 150 },
    { number: 3, title: "Mythology & Epics", description: "Journey through Indian mythology and epics", icon: "📖", status: "locked", points: 200 }
  ];

  sampleLevels.forEach(level => {
    // Check if level already exists
    db.get("SELECT id FROM levels WHERE number = ?", [level.number], (err, row) => {
      if (err) {
        console.error('Error checking level:', err);
        return;
      }
      if (!row) {
        // Insert sample level
        db.run(
          "INSERT INTO levels (number, title, description, icon, status, points) VALUES (?, ?, ?, ?, ?, ?)",
          [level.number, level.title, level.description, level.icon, level.status, level.points],
          function(err) {
            if (err) {
              console.error('Error inserting sample level:', err);
            } else {
              console.log(`Inserted level ${level.number}: ${level.title}`);
            }
          }
        );
      } else {
        console.log(`Level ${level.number} already exists`);
      }
    });
  });
}

// API Routes

// Get all levels
app.get('/api/levels', (req, res) => {
  db.all("SELECT * FROM levels ORDER BY number", (err, rows) => {
    if (err) {
      console.error('Error fetching levels:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(`Fetched ${rows.length} levels`);
    res.json(rows);
  });
});

// Get level by ID
app.get('/api/levels/:id', (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM levels WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(row);
  });
});

// Create new level
app.post('/api/levels', (req, res) => {
  const { number, title, description, icon, status, points } = req.body;
  
  db.run(
    "INSERT INTO levels (number, title, description, icon, status, points) VALUES (?, ?, ?, ?, ?, ?)",
    [number, title, description, icon, status, points],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id: this.lastID, message: 'Level created successfully' });
    }
  );
});

// Update level
app.put('/api/levels/:id', (req, res) => {
  const id = req.params.id;
  const { number, title, description, icon, status, points } = req.body;
  
  db.run(
    "UPDATE levels SET number = ?, title = ?, description = ?, icon = ?, status = ?, points = ? WHERE id = ?",
    [number, title, description, icon, status, points, id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ message: 'Level updated successfully' });
    }
  );
});

// Delete level
app.delete('/api/levels/:id', (req, res) => {
  const id = req.params.id;
  
  // First delete associated videos
  db.run("DELETE FROM videos WHERE level_id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    // Then delete the level
    db.run("DELETE FROM levels WHERE id = ?", [id], function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ message: 'Level and associated videos deleted successfully' });
    });
  });
});

// Get all videos
app.get('/api/videos', (req, res) => {
  db.all(`
    SELECT v.*, l.number as level_number, l.title as level_title 
    FROM videos v 
    LEFT JOIN levels l ON v.level_id = l.id 
    ORDER BY l.number, v.title
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching videos:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(`Fetched ${rows.length} videos`);
    res.json(rows);
  });
});

// Get videos by level ID
app.get('/api/videos/level/:levelId', (req, res) => {
  const levelId = req.params.levelId;
  db.all("SELECT * FROM videos WHERE level_id = ?", [levelId], (err, rows) => {
    if (err) {
      console.error('Error fetching videos for level:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(`Fetched ${rows.length} videos for level ${levelId}`);
    res.json(rows);
  });
});

// Upload video (store as base64)
app.post('/api/videos', (req, res) => {
  const { level_id, title, description, videoData, filename, fileSize, mimeType } = req.body;
  
  console.log('Uploading video:', { title, level_id, fileSize });
  
  if (!videoData) {
    return res.status(400).json({ error: 'No video data provided' });
  }

  db.run(
    "INSERT INTO videos (level_id, title, description, filename, file_size, mime_type, video_data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [level_id, title, description, filename, fileSize, mimeType, videoData],
    function(err) {
      if (err) {
        console.error('Error inserting video:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      console.log(`Video uploaded with ID: ${this.lastID}`);
      res.json({ 
        id: this.lastID, 
        message: 'Video uploaded successfully'
      });
    }
  );
});

// Get video data
app.get('/api/videos/:id', (req, res) => {
  const id = req.params.id;
  
  db.get("SELECT * FROM videos WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    if (!row) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }
    
    res.json(row);
  });
});

// Delete video
app.delete('/api/videos/:id', (req, res) => {
  const id = req.params.id;
  
  db.run("DELETE FROM videos WHERE id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ message: 'Video deleted successfully' });
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Serve the main HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/levels.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'levels.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`- Home: http://localhost:${PORT}/`);
  console.log(`- Levels: http://localhost:${PORT}/levels.html`);
  console.log(`- Admin: http://localhost:${PORT}/admin.html`);
  console.log(`- Health check: http://localhost:${PORT}/api/health`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nClosing database connection...');
  db.close((err) => {
    if (err) {
      console.error(err.message);
    }
    console.log('Database connection closed.');
    process.exit(0);
  });
});