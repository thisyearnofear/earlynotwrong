"use client";

import React, { useRef, useEffect } from "react";
import * as THREE from "three";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const IMAGES = [
  "/ENW/ENW01.jpg",
  "/ENW/ENW02.jpg",
  "/ENW/ENW03.jpg",
  "/ENW/ENW04.jpg",
  "/ENW/ENW05.jpg",
];

export function TunnelBackground() {
  const theme = useAppStore((state) => state.theme);
  const isDark = theme === "dark";
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const segmentsRef = useRef<THREE.Group[]>([]);
  const frameIdRef = useRef<number>(0);

  // Configuration
  const TUNNEL_WIDTH = 30;
  const TUNNEL_HEIGHT = 20;
  const SEGMENT_DEPTH = 10;
  const NUM_SEGMENTS = 10;
  const SPEED = 0.04;

  // --- THEME UPDATE EFFECT ---
  useEffect(() => {
    if (!sceneRef.current) return;

    const bgColor = isDark ? 0x000000 : 0xf8f8f8;
    const gridColor = isDark ? 0xffffff : 0x000000;
    const gridOp = isDark ? 0.12 : 0.08;
    const imgOp = isDark ? 0.35 : 0.2;

    sceneRef.current.background = new THREE.Color(bgColor);
    if (sceneRef.current.fog) {
      (sceneRef.current.fog as THREE.FogExp2).color.setHex(bgColor);
    }

    segmentsRef.current.forEach((segment) => {
      segment.children.forEach((child) => {
        if (child instanceof THREE.LineSegments) {
          const mat = child.material as THREE.LineBasicMaterial;
          mat.color.setHex(gridColor);
          mat.opacity = gridOp;
          mat.needsUpdate = true;
        }
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshBasicMaterial;
          mat.opacity = imgOp;
          mat.needsUpdate = true;
        }
      });
    });
  }, [isDark]);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Setup Scene
    const scene = new THREE.Scene();
    const bgColor = isDark ? 0x000000 : 0xf8f8f8;
    scene.background = new THREE.Color(bgColor);
    scene.fog = new THREE.FogExp2(bgColor, 0.012);
    sceneRef.current = scene;

    // 2. Setup Camera
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.z = 0;
    cameraRef.current = camera;

    // 3. Setup Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const textureLoader = new THREE.TextureLoader();

    // 4. Create Segment Function
    const createSegment = (zPos: number) => {
      const group = new THREE.Group();
      group.position.z = zPos;

      const w = TUNNEL_WIDTH / 2;
      const h = TUNNEL_HEIGHT / 2;
      const d = SEGMENT_DEPTH;

      // A. Grid Lines (Geometry)
      const lineMaterial = new THREE.LineBasicMaterial({
        color: isDark ? 0xffffff : 0x000000,
        transparent: true,
        opacity: isDark ? 0.12 : 0.08,
      });

      const lineGeo = new THREE.BufferGeometry();
      const vertices: number[] = [];

      // Longitudinal Lines
      const cols = 6;
      const colW = TUNNEL_WIDTH / cols;
      for (let i = 0; i <= cols; i++) {
        const x = -w + i * colW;
        vertices.push(x, -h, 0, x, -h, -d); // Floor
        vertices.push(x, h, 0, x, h, -d); // Ceiling
      }
      const rows = 4;
      const rowH = TUNNEL_HEIGHT / rows;
      for (let i = 0; i <= rows; i++) {
        const y = -h + i * rowH;
        vertices.push(-w, y, 0, -w, y, -d); // Left Wall
        vertices.push(w, y, 0, w, y, -d); // Right Wall
      }

      // Latitudinal Ring (at start of segment)
      vertices.push(-w, -h, 0, w, -h, 0);
      vertices.push(-w, h, 0, w, h, 0);
      vertices.push(-w, -h, 0, -w, h, 0);
      vertices.push(w, -h, 0, w, h, 0);

      lineGeo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      const lines = new THREE.LineSegments(lineGeo, lineMaterial);
      group.add(lines);

      // B. Random Image Slabs
      const addImageSlab = (
        pos: THREE.Vector3,
        rot: THREE.Euler,
        wd: number,
        ht: number,
      ) => {
        const src = IMAGES[Math.floor(Math.random() * IMAGES.length)];
        const geometry = new THREE.PlaneGeometry(wd * 0.9, ht * 0.9);
        const material = new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
        });

        textureLoader.load(src, (tex) => {
          material.map = tex;
          material.opacity = isDark ? 0.35 : 0.2;
          material.needsUpdate = true;
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(pos);
        mesh.rotation.copy(rot);
        group.add(mesh);
      };

      // Randomly populate walls
      if (Math.random() > 0.4) {
        // Floor slab
        addImageSlab(
          new THREE.Vector3(0, -h, -d / 2),
          new THREE.Euler(-Math.PI / 2, 0, 0),
          colW * 2,
          d,
        );
      }
      if (Math.random() > 0.6) {
        // Ceiling
        addImageSlab(
          new THREE.Vector3(0, h, -d / 2),
          new THREE.Euler(Math.PI / 2, 0, 0),
          colW * 2,
          d,
        );
      }
      if (Math.random() > 0.5) {
        // Left wall
        addImageSlab(
          new THREE.Vector3(-w, 0, -d / 2),
          new THREE.Euler(0, Math.PI / 2, 0),
          d,
          rowH * 2,
        );
      }
      if (Math.random() > 0.5) {
        // Right wall
        addImageSlab(
          new THREE.Vector3(w, 0, -d / 2),
          new THREE.Euler(0, -Math.PI / 2, 0),
          d,
          rowH * 2,
        );
      }

      return group;
    };

    // 5. Initial Generation
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const segment = createSegment(-i * SEGMENT_DEPTH);
      scene.add(segment);
      segmentsRef.current.push(segment);
    }

    // 6. Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      if (!rendererRef.current || !sceneRef.current || !cameraRef.current)
        return;

      // Move segments towards camera
      segmentsRef.current.forEach((group) => {
        group.position.z += SPEED;

        // Reset segment if it passes the camera
        if (group.position.z > SEGMENT_DEPTH) {
          group.position.z = -(NUM_SEGMENTS - 1) * SEGMENT_DEPTH;
        }
      });

      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };

    animate();

    // 7. Resize Handler
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      const width = window.innerWidth;
      const height = window.innerHeight;
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    // 8. Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(frameIdRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        rendererRef.current.forceContextLoss();
        rendererRef.current.domElement.remove();
      }
      // Dispose geometries/materials
      segmentsRef.current.forEach((group) => {
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (child.material.map) child.material.map.dispose();
            child.material.dispose();
          }
          if (child instanceof THREE.LineSegments) {
            child.geometry.dispose();
            child.material.dispose();
          }
        });
      });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-[-1] overflow-hidden pointer-events-none transition-colors duration-700",
        isDark ? "bg-black" : "bg-white",
      )}
    >
      {/* Overlay Vignette - Softened to allow images to breathe */}
      <div
        className={cn(
          "absolute inset-0 z-10",
          isDark
            ? "bg-[radial-gradient(circle_at_center,transparent_45%,#050505_100%)]"
            : "bg-[radial-gradient(circle_at_center,transparent_45%,#ffffff_100%)]",
        )}
      />

      {/* Overlay Grain/Scanlines */}
      <div className="absolute inset-0 z-20 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
    </div>
  );
}
