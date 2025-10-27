require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const securityLogger = require('./utils/securityLogger');
const { createServer } = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const httpServer = createServer(app);

const authRoutes = require('./routes/auth');
const reviewRoutes = require('./routes/reviews');
const commentRoutes = require('./routes/comments');
const favoriteRoutes = require('./routes/favorites');
const { router: chatRoutes, saveMessage } = require('./routes/chat');

// 🛡️ CONFIGURACIÓN DE SEGURIDAD
// Headers de seguridad con Helmet.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.themoviedb.org"]
    }
  },
  crossOriginEmbedderPolicy: false // Para permitir imágenes externas
}));

// Rate limiting para prevenir ataques de fuerza bruta
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por ventana
  message: {
    error: 'Demasiadas solicitudes desde esta IP, intenta más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting específico para autenticación
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // máximo 5 intentos de login por ventana
  message: {
    error: 'Demasiados intentos de login, intenta más tarde.'
  },
  skipSuccessfulRequests: true
});

app.use(limiter);
app.use('/api/auth', authLimiter);

// Security logging
app.use(securityLogger);

// Cookie parser para cookies seguras
app.use(cookieParser());

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://cinemablog-frontend.onrender.com',
    /\.onrender\.com$/
  ],
  credentials: true
}));

// Configurar Socket.IO con CORS
const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://cinemablog-frontend.onrender.com',
      /\.onrender\.com$/
    ],
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/chat', chatRoutes);

// 🔌 SOCKET.IO - Chat en tiempo real
io.on('connection', (socket) => {
  console.log('✅ Usuario conectado al chat:', socket.id);

  // Autenticar usuario al conectarse
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.userName = decoded.name || decoded.email;
      console.log(`🔐 Usuario autenticado: ${socket.userName}`);
    } catch (error) {
      console.error('❌ Error al autenticar socket:', error);
      socket.emit('auth_error', 'Token inválido');
    }
  });

  // Recibir mensaje del cliente
  socket.on('chat_message', async (data) => {
    try {
      const { content, userId, userName } = data;
      
      // Guardar mensaje en la base de datos
      const message = await saveMessage(content, userId, userName);
      
      // Emitir mensaje a todos los clientes conectados
      io.emit('new_message', message);
      
      console.log(`💬 Mensaje de ${userName}: ${content}`);
    } catch (error) {
      console.error('❌ Error al procesar mensaje:', error);
      socket.emit('message_error', 'Error al enviar mensaje');
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Usuario desconectado del chat:', socket.id);
  });
});

app.get('/', (req, res) => {
  res.send('API Miniblog funcionando');
});

// Inicializar base de datos al arrancar
async function initializeApp() {
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    
    // Verificar conexión y crear tablas si no existen
    await prisma.$connect();
    console.log('✅ Base de datos conectada correctamente');
    
    // Intentar crear las tablas usando raw SQL si no existen
    try {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "users" (
          "id" SERIAL NOT NULL,
          "email" TEXT NOT NULL,
          "password" TEXT NOT NULL,
          "name" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "users_email_key" UNIQUE ("email")
        );
      `;
      
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "reviews" (
          "id" SERIAL NOT NULL,
          "title" TEXT NOT NULL,
          "content" TEXT NOT NULL,
          "rating" INTEGER NOT NULL DEFAULT 0,
          "movieId" INTEGER NOT NULL,
          "movieTitle" TEXT,
          "posterPath" TEXT,
          "userId" INTEGER NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "reviews_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
        );
      `;
      
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "comments" (
          "id" SERIAL NOT NULL,
          "content" TEXT NOT NULL,
          "userId" INTEGER NOT NULL,
          "reviewId" INTEGER NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "comments_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "comments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
          CONSTRAINT "comments_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE
        );
      `;
      
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "favorites" (
          "id" SERIAL NOT NULL,
          "userId" INTEGER NOT NULL,
          "movieId" INTEGER NOT NULL,
          "movieTitle" TEXT,
          "posterPath" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "favorites_pkey" PRIMARY KEY ("id"),
          CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
          CONSTRAINT "favorites_user_movie_unique" UNIQUE ("userId", "movieId")
        );
      `;
      
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "messages" (
          "id" SERIAL NOT NULL,
          "content" TEXT NOT NULL,
          "userId" INTEGER NOT NULL,
          "userName" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
        );
      `;
      
      console.log('✅ Tablas verificadas/creadas correctamente');
    } catch (tableError) {
      console.log('⚠️  Las tablas probablemente ya existen:', tableError.message);
    }
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Error en inicialización:', error);
    // Continuar sin fallar la app
  }
}

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, async () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  await initializeApp();
});
