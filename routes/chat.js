const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const authenticate = require('../utils/authenticate');

const prisma = new PrismaClient();

// Obtener todos los mensajes del chat
router.get('/messages', authenticate, async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      orderBy: {
        createdAt: 'asc',
      },
      take: 100, // Limitar a los últimos 100 mensajes
    });

    res.json(messages);
  } catch (error) {
    console.error('Error al obtener mensajes:', error);
    res.status(500).json({ error: 'Error al obtener los mensajes' });
  }
});

// Guardar un mensaje (usado por socket.io)
async function saveMessage(content, userId, userName) {
  try {
    const message = await prisma.message.create({
      data: {
        content,
        userId,
        userName,
      },
    });
    return message;
  } catch (error) {
    console.error('Error al guardar mensaje:', error);
    throw error;
  }
}

module.exports = { router, saveMessage };
