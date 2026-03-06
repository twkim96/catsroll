# 1. 뼈대가 되는 Ruby 3.2 전체 환경 가져오기 (기본 컴파일러 내장)
FROM ruby:3.2

# 2. 필수 패키지 설치 (배열 탐색기에 필요한 clang 명시적 추가)
RUN apt-get update && apt-get install -y \
    clang \
    make \
    git \
    && rm -rf /var/lib/apt/lists/*

# 3. Hugging Face 환경에 맞게 유저 생성 (보안상 1000번 강제)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# 4. 코드를 컨테이너 안으로 복사
WORKDIR $HOME/app
COPY --chown=user . $HOME/app

# 5. 패키지 설치 (맥용 에러 우회 옵션 제거)
RUN gem install bundler lru_redux
RUN bundle config set --local path 'vendor/bundle'
RUN bundle install

# 6. 배열 탐색기 엔진 조립
RUN ./Seeker/bin/build-VampireFlower.sh

# 7. 설정 파일 에러 방지용 빈 파일 생성
RUN touch .env

# 8. Hugging Face 포트(7860) 설정
ENV WEB_BIND="0.0.0.0:7860"
EXPOSE 7860

# 9. 서버 실행
CMD ["bundle", "exec", "yahns", "-c", "config/yahns.rb"]