# Shortest Path on a Triangle Mesh

A 3D mesh viewer built with **Three.js** and **Vite** for exploring triangle meshes and vertex picking.

## Features

- **OBJ/STL model loading** - Load built-in models (bunny, chicken, diamond, snowman) or your own `.obj` / `.stl` files
- **Vertex highlight** - Hover over the mesh to highlight the nearest vertex
- **Orbit controls** - Rotate, pan, and zoom with the mouse
- **Real-time controls** via lil-gui (scale, visibility, model choice)
- **Keyboard shortcuts** - H to toggle model, R to reset

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)

### Installation

```bash
npm install
npm run dev
```

The app will be available at `http://localhost:3000`.

### Building for Production

```bash
npm run build
npm run preview
```

## Controls

| Key | Action |
|-----|--------|
| `H` | Toggle model visibility |
| `R` | Reset |

- **Left drag** - Rotate camera  
- **Right drag** - Pan  
- **Scroll** - Zoom  

## Project Structure

```
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── models/     # OBJ models (bunny, chicken, diamond, etc.)
└── src/
    ├── main.js     # Main application
    └── style.css
```

## Tech Stack

- [Three.js](https://threejs.org/) - 3D graphics
- [lil-gui](https://lil-gui.georgealways.com/) - GUI controls
- [Vite](https://vitejs.dev/) - Build tool

## License

MIT
