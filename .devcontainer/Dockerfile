FROM node:18-bullseye

# Installer Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Installer des outils utiles
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    nano \
    vim \
    && rm -rf /var/lib/apt/lists/*

# Créer le répertoire de travail
WORKDIR /workspace

# Copier les fichiers de configuration npm/bun
COPY package*.json ./
COPY bun.lockb* ./

# Installer les dépendances
RUN bun install

# Exposer les ports pour votre application
EXPOSE 3000 8080