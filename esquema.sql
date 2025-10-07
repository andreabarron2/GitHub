CREATE DATABASE little_nails;
USE little_nails;

CREATE TABLE Usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100),
  correo VARCHAR(100) UNIQUE,
  contrasena VARCHAR(255),
  rol ENUM('cliente','disenadora','admin')
);

CREATE TABLE Disenos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100),
  descripcion TEXT,
  precio DECIMAL(10,2)
);

CREATE TABLE Pedidos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT,
  id_diseno INT,
  fecha DATE,
  estado ENUM('pendiente','en proceso','terminado'),
  FOREIGN KEY (id_usuario) REFERENCES Usuarios(id),
  FOREIGN KEY (id_diseno) REFERENCES Disenos(id)
);
CREATE TABLE Comentarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_usuario INT,
  id_diseno INT,
  comentario TEXT,
  fecha DATE,
  FOREIGN KEY (id_usuario) REFERENCES Usuarios(id),
  FOREIGN KEY (id_diseno) REFERENCES Disenos(id)
);