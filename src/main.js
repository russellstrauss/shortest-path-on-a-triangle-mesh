import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import * as d3 from 'd3-scale-chromatic';
import GUI from 'lil-gui';

class App {
  constructor() {
    this.params = {
      objectScale: 4,
      showModel: true,
      modelChoice: 'bunny',
      starRadius: 800,
      pathExtrudeOffset: 0.01,
	  pointSize: 3,
      loadModel: () => this.openModelDialog(),
      reset: () => this.reset()
    };

    this.modelOptions = ['chicken', 'bunny', 'snowman', 'diamond'];
    
    // Base model size before scale multiplier is applied
    this.baseModelSize = 100;

    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.lastFpsUpdate = 0;

    this.init();
    this.setupLighting();
    this.addStars();
    this.setupGUI();
    this.setupKeyboardControls();
    this.loadDefaultModel();
    this.animate();
  }

  init() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("black");

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      50000
    );
    this.camera.position.set(500, 300, 500);
    this.params.starRadius = this.camera.position.length();

    // Renderer
    const canvas = document.getElementById('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // Controls (for non-animated viewing)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.25;
    this.controls.target.set(0, 0, 0);

    // Vertex highlight: raycaster and mouse for nearest-vertex picking (first layer only)
    this.raycaster = new THREE.Raycaster();
    this.mouseNDC = new THREE.Vector2();
    this._vertexHighlightTarget = new THREE.Vector3();
    this._vertexPickLocal = new THREE.Vector3(); // reusable in getNearestVertexInRange
    this._rendererSize = new THREE.Vector2();
    this.vertexHighlight = this.createVertexHighlight();
    this.scene.add(this.vertexHighlight);

    // Vertex selection (max 2); only when a vertex is highlighted on click; does not block orbit
    this.selectedVertices = [];
    this.selectedVertexMarkers = this.createSelectedVertexMarkers();
    this.scene.add(this.selectedVertexMarkers);
    this._mouseDownPos = new THREE.Vector2();
    this._clickDragThreshold = 5;
    this._lastHitMesh = null;
    this._lastHitVertexIndex = -1;
    this.pathLine = null; // THREE.Line for shortest path
    this.displayMode = 'mesh'; // 'points' = vertex mode, 'mesh' = wireframe mode
    this.pickableMeshes = []; // Invisible meshes used for raycast/path (when model is shown as Points)
    this.renderer.domElement.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.renderer.domElement.addEventListener('mouseup', (e) => this.onMouseUp(e));

    // Handle resize
    window.addEventListener('resize', () => this.onResize());

    this.renderer.domElement.addEventListener('mousemove', (e) => this.onMouseMove(e));
  }

  createVertexHighlight() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    const material = new THREE.PointsMaterial({
      color: 0x0099dd,
      size: 10,
      sizeAttenuation: false
    });
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    points.renderOrder = 1;
    return points;
  }

  createSelectedVertexMarkers() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(6, 3)); // 2 vertices
    const material = new THREE.PointsMaterial({
      color: 0x0099dd,
      size: 10,
      sizeAttenuation: false
    });
    const points = new THREE.Points(geometry, material);
    points.visible = false;
    points.renderOrder = 2;
    return points;
  }

  updateSelectedVertexMarkers() {
    const posAttr = this.selectedVertexMarkers.geometry.attributes.position;
    const count = this.selectedVertices.length;
    if (count === 0) {
      this.selectedVertexMarkers.visible = false;
      return;
    }
    for (let i = 0; i < count; i++) {
      const p = this.selectedVertices[i].position;
      posAttr.setXYZ(i, p.x, p.y, p.z);
    }
    posAttr.needsUpdate = true;
    this.selectedVertexMarkers.geometry.setDrawRange(0, count);
    this.selectedVertexMarkers.visible = true;
  }

  isClickOffMesh(clientX, clientY) {
    if (!this.viewingObject || !this.params.showModel) return true;
    const size = this.renderer.getSize(this._rendererSize);
    this.mouseNDC.x = (clientX / size.x) * 2 - 1;
    this.mouseNDC.y = -(clientY / size.y) * 2 + 1;
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const intersects = this.pickableMeshes.length
      ? this.raycaster.intersectObjects(this.pickableMeshes, true)
      : this.raycaster.intersectObject(this.viewingObject, true);
    return intersects.length === 0;
  }

  onMouseDown(event) {
    this._mouseDownPos.set(event.clientX, event.clientY);
  }

  onMouseUp(event) {
    const dx = event.clientX - this._mouseDownPos.x;
    const dy = event.clientY - this._mouseDownPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > this._clickDragThreshold) return;

    if (!this.viewingObject || !this.params.showModel) return;

    if (this.vertexHighlight.visible && this._lastHitMesh != null && this._lastHitVertexIndex >= 0) {
      const position = this.vertexHighlight.position.clone();
      const sameVertexEpsilon = 1e-4;
      const isSameAsSelected = this.selectedVertices.some(
        (v) => v.position.distanceTo(position) < sameVertexEpsilon
      );
      if (isSameAsSelected && this.selectedVertices.length === 1) {
        return;
      }
      const entry = { position, mesh: this._lastHitMesh, vertexIndex: this._lastHitVertexIndex };
      if (this.selectedVertices.length === 2) {
        this.selectedVertices = [entry];
      } else if (this.selectedVertices.length === 1) {
        this.selectedVertices = [this.selectedVertices[0], entry];
      } else {
        this.selectedVertices = [entry];
      }
      this.updateSelectedVertexMarkers();
      this.computeAndShowShortestPath();
      return;
    }

    if (this.isClickOffMesh(event.clientX, event.clientY)) {
      this.selectedVertices = [];
      this.updateSelectedVertexMarkers();
      this.clearPathLine();
    }
  }

  /**
   * Build a map from vertex index -> canonical (representative) index by merging vertices
   * that share the same position (so non-indexed geometry still has a connected graph).
   */
  buildVertexToCanonical(geometry) {
    const posAttr = geometry.attributes.position;
    if (!posAttr) return new Map();
    const keyToCanonical = new Map();
    const vertexToCanonical = new Map();
    const prec = 1e6;
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      const key = `${Math.round(v.x * prec)},${Math.round(v.y * prec)},${Math.round(v.z * prec)}`;
      if (!keyToCanonical.has(key)) {
        keyToCanonical.set(key, i);
      }
      vertexToCanonical.set(i, keyToCanonical.get(key));
    }
    return vertexToCanonical;
  }

  /**
   * Build adjacency list for mesh: map canonicalVertexIndex -> [{ neighbor, distance }, ...].
   * Merges vertices by position so non-indexed geometry produces a connected graph.
   */
  buildMeshGraph(geometry) {
    const posAttr = geometry.attributes.position;
    if (!posAttr) return new Map();
    const vertexToCanonical = this.buildVertexToCanonical(geometry);
    const graph = new Map();
    const v0 = new THREE.Vector3();
    const v1 = new THREE.Vector3();

    const addEdge = (a, b) => {
      const ca = vertexToCanonical.get(a);
      const cb = vertexToCanonical.get(b);
      if (ca === cb) return;
      v0.fromBufferAttribute(posAttr, ca);
      v1.fromBufferAttribute(posAttr, cb);
      const dist = v0.distanceTo(v1);
      if (!graph.has(ca)) graph.set(ca, []);
      const list = graph.get(ca);
      const existing = list.find((x) => x.neighbor === cb);
      if (!existing) list.push({ neighbor: cb, distance: dist });
    };

    const index = geometry.index;
    const numFaces = index ? index.count / 3 : posAttr.count / 3;
    for (let f = 0; f < numFaces; f++) {
      const [a, b, c] = this.getTriangleVertexIndices(geometry, f);
      addEdge(a, b);
      addEdge(b, a);
      addEdge(b, c);
      addEdge(c, b);
      addEdge(a, c);
      addEdge(c, a);
    }
    return graph;
  }

  /**
   * Dijkstra: shortest path from start to end. Returns { distance, path } or null if no path.
   */
  dijkstra(graph, start, end) {
    const dist = new Map();
    const prev = new Map();
    const Q = new Set(graph.keys());
    dist.set(start, 0);
    for (const v of Q) {
      if (v !== start) dist.set(v, Infinity);
    }

    while (Q.size > 0) {
      let u = -1;
      let best = Infinity;
      for (const v of Q) {
        const d = dist.get(v);
        if (d < best) {
          best = d;
          u = v;
        }
      }
      if (u === -1 || u === end) break;
      Q.delete(u);
      const neighbors = graph.get(u);
      if (!neighbors) continue;
      for (const { neighbor, distance: w } of neighbors) {
        if (!Q.has(neighbor)) continue;
        const alt = dist.get(u) + w;
        if (alt < dist.get(neighbor)) {
          dist.set(neighbor, alt);
          prev.set(neighbor, u);
        }
      }
    }

    const path = [];
    let cur = end;
    while (cur !== undefined && cur !== start) {
      path.unshift(cur);
      cur = prev.get(cur);
    }
    if (cur !== start) return null;
    path.unshift(start);
    return { distance: dist.get(end), path };
  }

  clearPathLine() {
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
      this.pathLine.material.dispose();
      this.pathLine = null;
    }
    const pathInfoEl = document.getElementById('path-info');
    if (pathInfoEl) {
      pathInfoEl.textContent = 'Click two vertices on the mesh to see the shortest path.';
      pathInfoEl.classList.remove('has-path');
    }
  }

  computeAndShowShortestPath() {
    this.clearPathLine();
    if (this.selectedVertices.length !== 2) return;
    const [a, b] = this.selectedVertices;
    if (a.mesh !== b.mesh) return; // different meshes: no path
    const mesh = a.mesh;
    const geometry = mesh.geometry;
    const vertexToCanonical = this.buildVertexToCanonical(geometry);
    const graph = this.buildMeshGraph(geometry);
    const startCanonical = vertexToCanonical.get(a.vertexIndex);
    const endCanonical = vertexToCanonical.get(b.vertexIndex);
    if (startCanonical === undefined || endCanonical === undefined || !graph.has(startCanonical) || !graph.has(endCanonical)) return;
    const result = this.dijkstra(graph, startCanonical, endCanonical);
    if (!result || result.path.length < 2) return;

    const posAttr = geometry.attributes.position;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const offsetAmount = geometry.boundingSphere.radius * (this.params.pathExtrudeOffset ?? 0.02);

    const _localPos = new THREE.Vector3();
    const _normal = new THREE.Vector3();
    const _bump = new THREE.Vector3();
    const _offsetDir = new THREE.Vector3();
    const points = [];

    for (let i = 0; i < result.path.length; i++) {
      _offsetDir.set(0, 0, 0);
      if (i > 0) {
        const faces = this.getFacesContainingEdge(geometry, result.path[i - 1], result.path[i]);
        _bump.set(0, 0, 0);
        for (const f of faces) {
          this.getFaceNormal(geometry, f, _normal);
          _bump.add(_normal);
        }
        if (faces.length > 0) {
          _bump.normalize();
          _offsetDir.add(_bump);
        }
      }
      if (i < result.path.length - 1) {
        const faces = this.getFacesContainingEdge(geometry, result.path[i], result.path[i + 1]);
        _bump.set(0, 0, 0);
        for (const f of faces) {
          this.getFaceNormal(geometry, f, _normal);
          _bump.add(_normal);
        }
        if (faces.length > 0) {
          _bump.normalize();
          _offsetDir.add(_bump);
        }
      }
      if (_offsetDir.lengthSq() > 0) _offsetDir.normalize();

      _localPos.fromBufferAttribute(posAttr, result.path[i]);
      _localPos.addScaledVector(_offsetDir, offsetAmount);
      mesh.localToWorld(_localPos);
      points.push(_localPos.clone());
    }

    const flatPositions = [];
    for (const p of points) flatPositions.push(p.x, p.y, p.z);
    const pathGeometry = new LineGeometry();
    pathGeometry.setPositions(flatPositions);
    const pathLineWidth = this.displayMode === 'points' ? 2 : 5;
    const pathMaterial = new LineMaterial({
      color: 0xff0000,
      linewidth: pathLineWidth,
      worldUnits: false,
      depthTest: true
    });
    pathMaterial.resolution = this.renderer.getSize(new THREE.Vector2());
    this.pathLine = new Line2(pathGeometry, pathMaterial);
    this.pathLine.renderOrder = 10;
    this.scene.add(this.pathLine);

    const pathInfoEl = document.getElementById('path-info');
    if (pathInfoEl) {
      pathInfoEl.textContent = `Shortest path: ${result.path.length - 1} edges`;
      pathInfoEl.classList.add('has-path');
    }
  }

  /**
   * Get the three vertex indices for the triangle at faceIndex.
   * @param {THREE.BufferGeometry} geometry
   * @param {number} faceIndex - Triangle index (not vertex index).
   * @returns {[number, number, number]}
   */
  getTriangleVertexIndices(geometry, faceIndex) {
    const index = geometry.index;
    if (index) {
      return [
        index.getX(faceIndex * 3),
        index.getX(faceIndex * 3 + 1),
        index.getX(faceIndex * 3 + 2)
      ];
    }
    return [faceIndex * 3, faceIndex * 3 + 1, faceIndex * 3 + 2];
  }

  /**
   * Get face indices that contain the edge between canonical vertices va and vb.
   * @param {THREE.BufferGeometry} geometry
   * @param {number} va - Canonical vertex index.
   * @param {number} vb - Canonical vertex index.
   * @returns {number[]} Face indices (0 or 1 for boundary, 2 for interior edge).
   */
  getFacesContainingEdge(geometry, va, vb) {
    const vertexToCanonical = this.buildVertexToCanonical(geometry);
    const index = geometry.index;
    const numFaces = index ? index.count / 3 : geometry.attributes.position.count / 3;
    const faces = [];
    for (let f = 0; f < numFaces; f++) {
      const [a, b, c] = this.getTriangleVertexIndices(geometry, f);
      const ca = vertexToCanonical.get(a);
      const cb = vertexToCanonical.get(b);
      const cc = vertexToCanonical.get(c);
      const hasVa = ca === va || cb === va || cc === va;
      const hasVb = ca === vb || cb === vb || cc === vb;
      if (hasVa && hasVb) faces.push(f);
    }
    return faces;
  }

  /**
   * Compute the unit normal of the triangle at faceIndex (outward from front face).
   * @param {THREE.BufferGeometry} geometry
   * @param {number} faceIndex
   * @param {THREE.Vector3} target - Vector to write the normal into.
   */
  getFaceNormal(geometry, faceIndex, target) {
    const posAttr = geometry.attributes.position;
    const [a, b, c] = this.getTriangleVertexIndices(geometry, faceIndex);
    const A = new THREE.Vector3().fromBufferAttribute(posAttr, a);
    const B = new THREE.Vector3().fromBufferAttribute(posAttr, b);
    const C = new THREE.Vector3().fromBufferAttribute(posAttr, c);
    const ba = new THREE.Vector3().subVectors(B, A);
    const ca = new THREE.Vector3().subVectors(C, A);
    target.crossVectors(ba, ca).normalize();
  }

  /**
   * Find the vertex of the hit triangle nearest to the intersection point, if within maxDistance.
   * @param {THREE.Mesh} mesh - The hit mesh (intersection.object).
   * @param {THREE.Intersection} intersection - First raycast intersection (has point, faceIndex).
   * @param {number} maxDistance - Max world-space distance from intersection.point to consider.
   * @param {THREE.Vector3} target - Reusable vector to write the nearest vertex world position.
   * @returns {{ found: boolean, vertexIndex: number }} - Found flag and the vertex index in the geometry.
   */
  getNearestVertexInRange(mesh, intersection, maxDistance, target) {
    const geometry = mesh.geometry;
    const posAttr = geometry.attributes.position;
    if (!posAttr) return { found: false, vertexIndex: -1 };

    const indices = this.getTriangleVertexIndices(geometry, intersection.faceIndex);
    const point = intersection.point;
    let bestDistSq = maxDistance * maxDistance;
    let found = false;
    let bestIdx = -1;
    const v = this._vertexPickLocal;

    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      v.fromBufferAttribute(posAttr, idx);
      mesh.localToWorld(v);
      const distSq = v.distanceToSquared(point);
      if (distSq <= bestDistSq) {
        bestDistSq = distSq;
        target.copy(v);
        found = true;
        bestIdx = idx;
      }
    }
    return { found, vertexIndex: bestIdx };
  }

  onMouseMove(event) {
    if (!this.viewingObject || !this.params.showModel) {
      this.vertexHighlight.visible = false;
      return;
    }

    const size = this.renderer.getSize(this._rendererSize);
    this.mouseNDC.x = (event.clientX / size.x) * 2 - 1;
    this.mouseNDC.y = -(event.clientY / size.y) * 2 + 1;

    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const intersects = this.pickableMeshes.length
      ? this.raycaster.intersectObjects(this.pickableMeshes, true)
      : this.raycaster.intersectObject(this.viewingObject, true);
    if (intersects.length === 0) {
      this.vertexHighlight.visible = false;
      return;
    }

    const hit = intersects[0];
    if (hit.faceIndex == null) {
      this.vertexHighlight.visible = false;
      return;
    }

    const box = new THREE.Box3().setFromObject(this.viewingObject);
    const diag = box.getSize(new THREE.Vector3()).length();
    const maxDistance = Math.max(diag * 0.03, 1e-6);

    const result = this.getNearestVertexInRange(hit.object, hit, maxDistance, this._vertexHighlightTarget);
    if (result.found) {
      this.vertexHighlight.position.copy(this._vertexHighlightTarget);
      this.vertexHighlight.visible = true;
      this._lastHitMesh = hit.object;
      this._lastHitVertexIndex = result.vertexIndex;
    } else {
      this.vertexHighlight.visible = false;
      this._lastHitMesh = null;
      this._lastHitVertexIndex = -1;
    }
  }

  addStars() {
    if (this.starPoints) {
      this.scene.remove(this.starPoints);
      this.starPoints.geometry.dispose();
      this.starPoints.material.dispose();
      this.starPoints = null;
    }
    const radius = this.params.starRadius;
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    for (let i = 0; i < 500; i++) {
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = 2 * Math.PI * Math.random();
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.sin(phi) * Math.sin(theta);
      const z = Math.cos(phi);
      vertices.push(x * radius, y * radius, z * radius);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const particles = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x888888 }));
    this.starPoints = particles;
    this.scene.add(particles);
  }

  setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambientLight);

    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(100, 200, 100);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 1000;
    directionalLight.shadow.camera.left = -200;
    directionalLight.shadow.camera.right = 200;
    directionalLight.shadow.camera.top = 200;
    directionalLight.shadow.camera.bottom = -200;
    this.scene.add(directionalLight);

    // Accent lights for atmosphere
    const cyanLight = new THREE.PointLight(0x00f0ff, 0.8, 500);
    cyanLight.position.set(-100, 50, 100);
    this.scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xff00aa, 0.5, 400);
    magentaLight.position.set(100, 80, -100);
    this.scene.add(magentaLight);

    // Hemisphere light for natural feel
    const hemiLight = new THREE.HemisphereLight(0x0088ff, 0x002244, 0.4);
    this.scene.add(hemiLight);
  }

  setupGUI() {
    this.gui = new GUI({ title: '⟨ CONTROLS ⟩' });

    const viewFolder = this.gui.addFolder('Viewing');
    viewFolder.add(this.params, 'objectScale', 0.1, 10, 0.1).name('Model Scale').onChange(() => this.updateModelScale());
    viewFolder.add(this.params, 'starRadius', 100, 10000, 50).name('Star Radius').onChange(() => this.addStars());
    viewFolder.open();

    const togglesFolder = this.gui.addFolder('Toggles');
    togglesFolder.add(this.params, 'showModel').name('Show Model (H)').onChange(() => this.toggleModelVisibility());
    togglesFolder.open();

    const modelFolder = this.gui.addFolder('Model');
    modelFolder.add(this.params, 'modelChoice', this.modelOptions).name('Default Model').onChange(() => this.loadSelectedModel());
    modelFolder.add(this.params, 'loadModel').name('📁 Load Custom...');
    modelFolder.open();

    const pathFolder = this.gui.addFolder('Path');
    pathFolder.add(this.params, 'pathExtrudeOffset', 0, 0.2, 0.005).name('Extrude offset').onChange(() => {
      if (this.selectedVertices.length === 2) this.computeAndShowShortestPath();
    });

    const actionsFolder = this.gui.addFolder('Actions');
    actionsFolder.add(this.params, 'reset').name('🔄 Reset');

    // Hide the controls panel
    this.gui.domElement.style.display = 'none';
  }

  setupKeyboardControls() {
    window.addEventListener('keydown', (e) => {
      switch(e.key.toLowerCase()) {
        case 'r':
          this.reset();
          break;
        case 'h':
          this.params.showModel = !this.params.showModel;
          this.toggleModelVisibility();
          if (this.gui) this.gui.controllersRecursive().forEach(c => c.updateDisplay());
          break;
        case 't':
          this.setDisplayMode('mesh');
          break;
        case 'v':
          this.setDisplayMode('points');
          break;
      }
    });
  }

  /**
   * Convert CSS rgb(r,g,b) string to THREE.Color (0–1).
   */
  rgbStringToColor(rgbString) {
    const parts = rgbString.replace('rgb(', '').replace(')', '').replace(/\s/g, '').split(',');
    return new THREE.Color(parts[0] / 255, parts[1] / 255, parts[2] / 255);
  }

  /**
   * Build a Group that shows geometry as vertex points and/or triangle mesh with vertex colors,
   * and keeps invisible meshes for raycasting/path finding. Returns { group, pickableMeshes }.
   * group.userData.pointsChildren and group.userData.meshChildren are used for T/V toggle.
   */
  buildPointsViewFromMeshes(meshesOrGroup, pointSize = 1.5) {
    const group = new THREE.Group();
    const pickableMeshes = [];
    const pointsChildren = [];
    const meshChildren = [];
    const pointsMaterial = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      sizeAttenuation: true
    });
    const triangleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.9
    });
    const invisibleMaterial = new THREE.MeshBasicMaterial({
      visible: false,
      depthWrite: false
    });

    const processMesh = (mesh) => {
      if (!(mesh instanceof THREE.Mesh) || !mesh.geometry) return;
      const geometry = mesh.geometry;
      const points = new THREE.Points(geometry, pointsMaterial.clone());
      const triangleMesh = new THREE.Mesh(geometry, triangleMaterial.clone());
      triangleMesh.visible = false;
      const pickMesh = new THREE.Mesh(geometry, invisibleMaterial.clone());
      const subgroup = new THREE.Group();
      subgroup.position.copy(mesh.position);
      subgroup.quaternion.copy(mesh.quaternion);
      subgroup.scale.copy(mesh.scale);
      subgroup.add(points);
      subgroup.add(triangleMesh);
      subgroup.add(pickMesh);
      group.add(subgroup);
      pickableMeshes.push(pickMesh);
      pointsChildren.push(points);
      meshChildren.push(triangleMesh);
    };

    if (Array.isArray(meshesOrGroup)) {
      meshesOrGroup.forEach(processMesh);
    } else {
      meshesOrGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) processMesh(child);
      });
    }
    group.userData.pointsChildren = pointsChildren;
    group.userData.meshChildren = meshChildren;
    return { group, pickableMeshes };
  }

  /**
   * Toggle display between vertex cloud ('points') and triangle mesh ('mesh').
   */
  setDisplayMode(mode) {
    if (!this.viewingObject || !this.viewingObject.userData.pointsChildren) return;
    this.displayMode = mode;
    const pointsChildren = this.viewingObject.userData.pointsChildren;
    const meshChildren = this.viewingObject.userData.meshChildren;
    const showPoints = mode === 'points';
    pointsChildren.forEach((p) => { p.visible = showPoints; });
    meshChildren.forEach((m) => { m.visible = !showPoints; });
    if (this.pathLine && this.pathLine.material) {
      this.pathLine.material.linewidth = mode === 'points' ? 2 : 5;
    }
  }

  /**
   * Add vertex colors to a BufferGeometry using d3 interpolateYlGnBu (optionally reversed).
   */
  addVertexColorsToGeometry(geometry, reverseColors = true) {
    const posAttr = geometry.attributes.position;
    if (!posAttr) return;
    const vertexCount = posAttr.count;
    const colors = [];
    for (let i = 0; i < vertexCount; i++) {
      const t = vertexCount > 1 ? i / (vertexCount - 1) : 1;
      const rgbString = d3.interpolateYlGnBu(t);
      const color = this.rgbStringToColor(rgbString);
      colors.push(color.r, color.g, color.b);
    }
    if (reverseColors) {
      const reversed = [];
      for (let v = vertexCount - 1; v >= 0; v--) {
        reversed.push(colors[v * 3], colors[v * 3 + 1], colors[v * 3 + 2]);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(reversed, 3));
    } else {
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
  }

  loadDefaultModel() {
    this.loadSelectedModel();
  }

  showFileProtocolMessage() {
    const pathInfoEl = document.getElementById('path-info');
    if (pathInfoEl) {
      pathInfoEl.innerHTML = 'Models cannot load when opening the file directly. Run <code>npm run dev</code> and open the URL shown in the terminal (e.g. http://localhost:5173).';
      pathInfoEl.classList.add('has-path');
    }
  }

  loadFallbackModel() {
    const geometry = new THREE.IcosahedronGeometry(25, 2);
    this.addVertexColorsToGeometry(geometry, true);
    const { group, pickableMeshes } = this.buildPointsViewFromMeshes([
      new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    ], 2);
    this.viewingObject = group;
    this.pickableMeshes = pickableMeshes;
    this.viewingObject.userData.baseScale = this.baseModelSize;
    this.viewingObject.scale.setScalar(this.baseModelSize * this.params.objectScale);
    this.viewingObject.visible = this.params.showModel;
    this.scene.add(this.viewingObject);
    this.setDisplayMode(this.displayMode);
    this.frameModelInView();
  }

  loadSelectedModel() {
    // Remove old model
    if (this.viewingObject) {
      this.scene.remove(this.viewingObject);
      this.viewingObject.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.viewingObject = null;
    }
    this.pickableMeshes = [];
    this.selectedVertices = [];
    this.updateSelectedVertexMarkers();
    this.clearPathLine();

    // Browsers block fetch() when the page is opened via file://. Run with: npm run dev
    if (window.location.protocol === 'file:') {
      this.showFileProtocolMessage();
      this.loadFallbackModel();
      return;
    }

    // Resolve model URL from document base so the loader fetches the correct origin/path
    // (relative paths can be resolved against the script URL otherwise, causing 404/NetworkError)
    const baseUrl = new URL(import.meta.env.BASE_URL || './', window.location.href);
    const modelPath = new URL(`models/${this.params.modelChoice}.obj`, baseUrl).href;
    const loader = new OBJLoader();
    
    console.log(`Loading model from: ${modelPath}`);
    
    loader.load(
      modelPath,
      (obj) => {
        console.log('Model loaded successfully:', obj);
        
        let meshCount = 0;
        let vertexCount = 0;
        
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            meshCount++;
            vertexCount += child.geometry.attributes.position?.count || 0;
            if (!child.geometry.attributes.position || child.geometry.attributes.position.count === 0) {
              console.warn('Mesh has no vertices:', child);
            }
            this.addVertexColorsToGeometry(child.geometry, true);
          }
        });
        
        console.log(`Model contains ${meshCount} meshes with ${vertexCount} total vertices`);
        
        if (meshCount === 0) {
          console.error('Model loaded but contains no meshes!');
          this.loadFallbackModel();
          return;
        }
        
        const { group, pickableMeshes } = this.buildPointsViewFromMeshes(obj, this.params.pointSize);
        this.viewingObject = group;
        this.pickableMeshes = pickableMeshes;
        this.viewingObject.userData.baseScale = this.baseModelSize;
        this.viewingObject.scale.setScalar(this.baseModelSize * this.params.objectScale);
        this.centerModel(this.viewingObject);
        this.viewingObject.visible = this.params.showModel;
        this.scene.add(this.viewingObject);
        this.setDisplayMode(this.displayMode);
        this.frameModelInView();
      },
      (progress) => {
        if (progress.lengthComputable) {
          const percentComplete = (progress.loaded / progress.total) * 100;
          console.log(`Model loading: ${percentComplete.toFixed(2)}%`);
        }
      },
      (error) => {
        this.loadFallbackModel();
      }
    );
  }

  openModelDialog() {
    const input = document.getElementById('model-input');
    input.click();
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadModelFile(file);
      }
    };
  }

  loadModelFile(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const url = URL.createObjectURL(file);

    // Remove old model (same cleanup as loadSelectedModel)
    if (this.viewingObject) {
      this.scene.remove(this.viewingObject);
      this.viewingObject.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.viewingObject = null;
    }
    this.pickableMeshes = [];
    this.selectedVertices = [];
    this.updateSelectedVertexMarkers();
    this.clearPathLine();

    if (extension === 'obj') {
      const loader = new OBJLoader();
      loader.load(url, (obj) => {
        obj.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            this.addVertexColorsToGeometry(child.geometry, true);
          }
        });
        const { group, pickableMeshes } = this.buildPointsViewFromMeshes(obj, 1.5);
        this.viewingObject = group;
        this.pickableMeshes = pickableMeshes;
        this.viewingObject.userData.baseScale = this.baseModelSize;
        this.viewingObject.scale.setScalar(this.baseModelSize * this.params.objectScale);
        this.centerModel(this.viewingObject);
        this.viewingObject.visible = this.params.showModel;
        this.scene.add(this.viewingObject);
        this.setDisplayMode(this.displayMode);
        this.frameModelInView();
        URL.revokeObjectURL(url);
      });
    } else if (extension === 'stl') {
      const loader = new STLLoader();
      loader.load(url, (geometry) => {
        geometry.computeVertexNormals();
        this.addVertexColorsToGeometry(geometry, true);
        const { group, pickableMeshes } = this.buildPointsViewFromMeshes([
          new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
        ], 1.5);
        this.viewingObject = group;
        this.pickableMeshes = pickableMeshes;
        this.viewingObject.userData.baseScale = this.baseModelSize;
        this.viewingObject.scale.setScalar(this.baseModelSize * this.params.objectScale);
        this.centerModel(this.viewingObject);
        this.viewingObject.visible = this.params.showModel;
        this.scene.add(this.viewingObject);
        this.setDisplayMode(this.displayMode);
        this.frameModelInView();
        URL.revokeObjectURL(url);
      });
    }
  }

  centerModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.position.y = 0; // Place on ground
  }

  /**
   * Frame the current model in the viewport: point camera at its center and set distance so it fits.
   */
  frameModelInView() {
    if (!this.viewingObject) return;
    const box = new THREE.Box3().setFromObject(this.viewingObject);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const distance = Math.abs(maxDim / (2 * Math.tan(fovRad / 2))) * 1.4;
    this.controls.target.copy(center);
    const direction = new THREE.Vector3(1, 0.6, 1).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.params.starRadius = this.camera.position.length();
  }

  updateModelScale() {
    if (this.viewingObject) {
      const baseScale = this.viewingObject.userData.baseScale || this.baseModelSize;
      this.viewingObject.scale.setScalar(baseScale * this.params.objectScale);
    }
  }

  toggleModelVisibility() {
    if (this.viewingObject) {
      this.viewingObject.visible = this.params.showModel;
    }
  }

  reset() {
    this.params.objectScale = 4;
    this.params.showModel = true;
    this.selectedVertices = [];
    this.updateSelectedVertexMarkers();
    this.clearPathLine();
    this.loadSelectedModel();
    this.gui.controllersRecursive().forEach(c => c.updateDisplay());
  }

  updateCamera() {
    this.controls.enabled = true;
  }

  updateFPS(time) {
    // FPS tracking (display removed)
    this.frameCount++;
    if (time - this.lastFpsUpdate >= 1000) {
      this.frameCount = 0;
      this.lastFpsUpdate = time;
    }
  }

  onResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.pathLine && this.pathLine.material.resolution) {
      this.pathLine.material.resolution.set(width, height);
    }
  }

  animate() {
    requestAnimationFrame((time) => {
      this.animate();
      this.updateFPS(time);
    });

    this.updateCamera();
    this.controls.update();
    if (this.pathLine && this.pathLine.material.resolution) {
      this.renderer.getSize(this._rendererSize);
      this.pathLine.material.resolution.copy(this._rendererSize);
    }
    this.renderer.render(this.scene, this.camera);
  }
}

// Start the application
new App();

